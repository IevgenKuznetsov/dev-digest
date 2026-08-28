import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRunExecutor, type Logger } from '../reviews/run-executor.js';
import { ReviewRepository } from '../reviews/repository.js';
import { MultiAgentReviewRepository } from './repository.js';
import { computeConflicts } from './conflict.js';
import type {
  MultiAgentRunResponse,
  MultiAgentRunDetail,
  MultiAgentEstimate,
  AgentEstimate,
} from '@devdigest/shared';

/**
 * Multi-Agent Review Service.
 * Orchestrates creation, execution, and retrieval of multi-agent runs.
 * Delegates all DB access to MultiAgentReviewRepository and ReviewRepository.
 * No Drizzle operators here — all queries go through the repository layer.
 */
export class MultiAgentReviewService {
  private repo: MultiAgentReviewRepository;
  private reviewRepo: ReviewRepository;
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new MultiAgentReviewRepository(container.db);
    this.reviewRepo = new ReviewRepository(container.db);
    this.executor = new ReviewRunExecutor(container, this.reviewRepo, container.agentsRepo);
  }

  /**
   * Create a multi-agent run: validates PR + agents, inserts DB rows,
   * fires-and-forgets execution, and returns the response immediately.
   */
  async createAndExecute(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<MultiAgentRunResponse> {
    // Defense-in-depth: Zod min(1) handles empty arrays at route level
    if (agentIds.length === 0) {
      throw new AppError('invalid_run_request', 'At least one agent must be selected.', 400);
    }

    // Validate PR belongs to workspace
    const pull = await this.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found', { code: 'pull_not_found' });

    const repoRow = await this.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // Validate all agent IDs belong to the workspace
    const agents: AgentRow[] = [];
    for (const agentId of agentIds) {
      const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
      if (!agent) {
        throw new NotFoundError('Agent not found', { code: 'agent_not_found' });
      }
      agents.push(agent);
    }

    // Create multi_agent_runs row
    const multiAgentRunId = await this.repo.createMultiAgentRun(workspaceId, prId);

    // Create agent_runs rows up front so clients can subscribe to SSE immediately
    const runs: MultiAgentRunResponse['runs'] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];

    for (const agent of agents) {
      const runId = await this.reviewRepo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        agentName: agent.name,
        multiAgentRunId,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: HTTP response returns with runIds immediately.
    // parallel:true — multi-agent runs execute all agents concurrently.
    void this.executor.executeRuns(workspaceId, pull, repoRow, jobs, logger, { parallel: true }).catch((err) => {
      logger?.error(
        { prId, multiAgentRunId, err: (err as Error).message },
        'multi-agent-review: background execution crashed',
      );
    });

    return { id: multiAgentRunId, runs };
  }

  /**
   * Fetch the full multi-agent run detail for the results page.
   * Workspace-scoped: returns 404 if not found or belongs to another workspace.
   */
  async getMultiAgentRun(
    workspaceId: string,
    multiAgentRunId: string,
  ): Promise<MultiAgentRunDetail> {
    const runRow = await this.repo.getMultiAgentRun(workspaceId, multiAgentRunId);
    if (!runRow) throw new NotFoundError('Multi-agent run not found');

    // Fetch column data (agent runs + reviews + findings)
    const columns = await this.repo.getRunsForMultiAgent(multiAgentRunId);

    // Fetch raw findings for conflict computation (includes end_line)
    const conflictFindings = await this.repo.getFindingsForConflict(multiAgentRunId);

    // Compute conflicts using only non-empty agent IDs
    const allAgentIds = columns
      .map((c) => c.agent_id)
      .filter((id): id is string => id.length > 0);
    const conflicts = computeConflicts(conflictFindings, allAgentIds);

    // Compute aggregate stats: total_duration = max, total_cost = sum
    const completedColumns = columns.filter((c) => c.status === 'done');
    const total_duration_ms =
      completedColumns.length > 0
        ? Math.max(...completedColumns.map((c) => c.duration_ms ?? 0))
        : 0;
    const costValues = completedColumns.map((c) => c.cost_usd).filter((v): v is number => v !== null);
    const total_cost_usd = costValues.length > 0 ? costValues.reduce((a, b) => a + b, 0) : null;

    // Fetch PR number for the response (join with pull_requests)
    const pull = await this.reviewRepo.getPull(workspaceId, runRow.prId);
    const pr_number = pull?.number ?? null;

    return {
      id: runRow.id,
      pr_id: runRow.prId,
      pr_number,
      ran_at: runRow.ranAt.toISOString(),
      agent_count: columns.length,
      total_duration_ms,
      total_cost_usd,
      columns,
      conflicts,
    };
  }

  /**
   * Get pre-run estimates for all agents in the workspace.
   * For each agent, uses the most recent completed agent_run for cost/duration.
   */
  async getEstimates(workspaceId: string): Promise<MultiAgentEstimate> {
    const agents = await this.container.agentsRepo.list(workspaceId);
    const latestRuns = await this.repo.getLatestCompletedRuns(workspaceId);

    const agentEstimates: AgentEstimate[] = agents.map((agent) => {
      const latest = latestRuns.get(agent.id);
      return {
        agent_id: agent.id,
        agent_name: agent.name,
        cost_usd: latest?.cost_usd ?? null,
        duration_ms: latest?.duration_ms ?? null,
      };
    });

    const hasData = agentEstimates.filter((a) => a.cost_usd !== null || a.duration_ms !== null);
    const is_partial = agentEstimates.some((a) => a.cost_usd === null && a.duration_ms === null);

    const total_cost_usd =
      hasData.length > 0
        ? hasData.reduce((sum, a) => sum + (a.cost_usd ?? 0), 0)
        : null;

    const durationValues = agentEstimates.map((a) => a.duration_ms).filter((v): v is number => v !== null);
    const total_duration_ms = durationValues.length > 0 ? Math.max(...durationValues) : null;

    return {
      agents: agentEstimates,
      total_cost_usd,
      total_duration_ms,
      is_partial,
    };
  }
}
