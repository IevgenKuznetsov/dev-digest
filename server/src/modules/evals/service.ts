/**
 * Eval Pipeline — service layer.
 *
 * Orchestrates eval case CRUD, batch execution, scoring, comparison, and
 * version promotion. Uses its own PQueue (concurrency 2) to isolate eval
 * LLM calls from review/indexing work.
 */

import PQueue from 'p-queue';
import type { Container } from '../../platform/container.js';
import type { ExpectedOutputItem, Finding, AgentVersionConfig } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { EvalRepository } from './repository.js';
import { AgentsService } from '../agents/service.js';
import { AgentsRepository, type AgentRow } from '../agents/repository.js';
import {
  computePass,
  computeCitationAccuracy,
  computeBatchMetrics,
  type CaseResult,
} from './scoring.js';
import { parseDiffToUnifiedDiff, toEvalCaseDto, toEvalRunDto, toEvalBatchDto } from './helpers.js';
import { EVAL_BATCH_CONCURRENCY } from './constants.js';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { CreateEvalCaseInput, UpdateEvalCaseInput, TimeRangeFilter } from '@devdigest/shared';

// ===========================================================================
// Service
// ===========================================================================

export class EvalsService {
  private repo: EvalRepository;
  private agentsRepo: AgentsRepository;
  private agentsService: AgentsService;
  /** In-memory lock map: ownerId → active batch promise (AC-UB5 fast-path). */
  private activeLocks = new Map<string, Promise<void>>();
  /** Own PQueue instance for eval batch execution (concurrency 2). */
  private queue = new PQueue({ concurrency: EVAL_BATCH_CONCURRENCY });

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
    this.agentsRepo = new AgentsRepository(container.db);
    this.agentsService = new AgentsService(container);
  }

  // ===========================================================================
  // Eval Case CRUD
  // ===========================================================================

  async createCase(workspaceId: string, agentId: string, input: CreateEvalCaseInput) {
    // Verify agent exists in workspace
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const row = await this.repo.createCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
      sourceFindingId: input.source_finding_id ?? null,
    });
    return toEvalCaseDto(row);
  }

  async getCase(workspaceId: string, caseId: string) {
    const row = await this.repo.getCase(workspaceId, caseId);
    if (!row) throw new NotFoundError('Eval case not found');
    return toEvalCaseDto(row);
  }

  async listCases(workspaceId: string, agentId: string) {
    const rows = await this.repo.listCasesForOwner(workspaceId, agentId);
    return rows.map(toEvalCaseDto);
  }

  async updateCase(workspaceId: string, caseId: string, input: UpdateEvalCaseInput) {
    const row = await this.repo.updateCase(workspaceId, caseId, {
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes,
      sourceFindingId: input.source_finding_id ?? null,
    });
    if (!row) throw new NotFoundError('Eval case not found');
    return toEvalCaseDto(row);
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<{ ok: boolean }> {
    const deleted = await this.repo.deleteCase(workspaceId, caseId);
    if (!deleted) throw new NotFoundError('Eval case not found');
    return { ok: true };
  }

  // ===========================================================================
  // Single-case eval execution
  // ===========================================================================

  async runSingleCase(workspaceId: string, caseId: string) {
    const caseRow = await this.repo.getCase(workspaceId, caseId);
    if (!caseRow) throw new NotFoundError('Eval case not found');

    const agent = await this.agentsRepo.getById(workspaceId, caseRow.ownerId);
    if (!agent) throw new NotFoundError('Agent not found');

    return this._executeSingleCase(agent, caseRow as NonNullable<typeof caseRow>, null);
  }

  /**
   * Execute a single eval case and persist the run row.
   * Returns the run DTO. batchId is null for standalone runs.
   */
  private async _executeSingleCase(
    agent: AgentRow,
    caseRow: NonNullable<Awaited<ReturnType<typeof this.repo.getCase>>>,
    batchId: string | null,
  ) {
    const start = Date.now();

    try {
      // Resolve the LLM provider for this agent
      const llm = await this.container.llm(agent.provider as 'openai' | 'anthropic' | 'openrouter');

      // Load skills linked to this agent
      const linkedSkills = await this.agentsRepo.linkedSkills(agent.id);
      const skillBodies = linkedSkills
        .filter((ls) => ls.skill.enabled)
        .map((ls) => ls.skill.body);

      // Parse the unified diff
      const diff = parseDiffToUnifiedDiff(caseRow.inputDiff ?? '');

      // Run the review engine
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        strategy: agent.strategy as 'auto' | 'single-pass' | 'map-reduce',
        skills: skillBodies,
      });

      const actualFindings: Finding[] = outcome.review.findings;
      const expectedOutput = (caseRow.expectedOutput ?? []) as ExpectedOutputItem[];

      const pass = computePass(expectedOutput, actualFindings);
      const citationAccuracy = computeCitationAccuracy(expectedOutput, actualFindings);
      const durationMs = Date.now() - start;
      const costUsd = outcome.costUsd;

      const runRow = await this.repo.createRun({
        caseId: caseRow.id,
        batchId,
        actualOutput: actualFindings,
        pass,
        citationAccuracy,
        durationMs,
        costUsd,
        error: null,
      });

      return toEvalRunDto(runRow);
    } catch (err) {
      const errorMsg = (err as Error).message;
      const durationMs = Date.now() - start;
      const runRow = await this.repo.createRun({
        caseId: caseRow.id,
        batchId,
        actualOutput: null,
        pass: null,
        citationAccuracy: null,
        durationMs,
        costUsd: null,
        error: errorMsg,
      });
      return toEvalRunDto(runRow);
    }
  }

  // ===========================================================================
  // Batch execution
  // ===========================================================================

  /**
   * Start a batch eval run. Creates the batch row and returns the batch ID
   * immediately (202 Accepted). Execution is fire-and-forget on the PQueue.
   *
   * Throws 409 if a batch is already running/queued for this agent (AC-UB5).
   * Throws 400 if there are no eval cases for this agent (EDGE-1).
   */
  async startBatch(workspaceId: string, agentId: string): Promise<{ batch_id: string }> {
    const agentOrNull = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agentOrNull) throw new NotFoundError('Agent not found');
    const agent: AgentRow = agentOrNull;

    // Fast-path in-memory lock check
    if (this.activeLocks.has(agentId)) {
      throw new AppError('batch_conflict', 'A batch is already running for this agent', 409);
    }

    // Authoritative DB check (handles multi-instance or post-restart scenarios)
    const activeBatch = await this.repo.getActiveBatchForOwner(agentId);
    if (activeBatch) {
      throw new AppError('batch_conflict', 'A batch is already running for this agent', 409);
    }

    // Check that there are cases to run
    const cases = await this.repo.listCasesForOwner(workspaceId, agentId);
    if (cases.length === 0) {
      throw new AppError('no_eval_cases', 'No eval cases to run', 400);
    }

    // Create batch row
    const batch = await this.repo.createBatch({
      ownerId: agentId,
      ownerKind: 'agent',
      agentVersion: agent.version,
      status: 'queued',
    });

    // Fire-and-forget execution
    const executionPromise = this.queue.add(() =>
      this._executeBatch(workspaceId, agentId, agent, batch.id, cases),
    ) as Promise<void>;

    // Track in-memory lock — remove when done
    void executionPromise.finally(() => {
      this.activeLocks.delete(agentId);
    });
    this.activeLocks.set(agentId, executionPromise);

    return { batch_id: batch.id };
  }

  private async _executeBatch(
    workspaceId: string,
    agentId: string,
    agent: AgentRow,
    batchId: string,
    cases: Awaited<ReturnType<typeof this.repo.listCasesForOwner>>,
  ): Promise<void> {
    const batchStart = Date.now();

    await this.repo.updateBatch(batchId, { status: 'running' });

    const caseResults: CaseResult[] = [];
    let totalCostUsd = 0;
    let anySucceeded = false;

    for (const caseRow of cases) {
      try {
        const runDto = await this._executeSingleCase(agent, caseRow as NonNullable<typeof caseRow>, batchId);

        const expectedOutput = (caseRow.expectedOutput ?? []) as ExpectedOutputItem[];
        const actualFindings = (runDto.actual_output ?? []) as Finding[];

        caseResults.push({
          expected: expectedOutput,
          actual: actualFindings,
          pass: runDto.pass,
          citationAccuracy: runDto.citation_accuracy,
        });

        totalCostUsd += runDto.cost_usd ?? 0;
        if (runDto.pass !== null) anySucceeded = true;
      } catch (err) {
        // Per-case failure — record null pass and continue (AC-UB2)
        caseResults.push({
          expected: (caseRow.expectedOutput ?? []) as ExpectedOutputItem[],
          actual: [],
          pass: null,
          citationAccuracy: null,
        });
      }
    }

    const batchDurationMs = Date.now() - batchStart;
    const metrics = computeBatchMetrics(caseResults);

    // Determine final status (AC-UB3: all failed → 'failed')
    const finalStatus = anySucceeded ? 'done' : 'failed';

    await this.repo.updateBatch(batchId, {
      status: finalStatus,
      recall: metrics.recall,
      precision: metrics.precision,
      citationAccuracy: metrics.citation_accuracy,
      tracesTotal: metrics.traces_total,
      tracesPassed: metrics.traces_passed,
      costUsd: totalCostUsd,
      durationMs: batchDurationMs,
    });
  }

  // ===========================================================================
  // Batch queries
  // ===========================================================================

  async getBatch(workspaceId: string, batchId: string) {
    const batch = await this.repo.getBatchScoped(workspaceId, batchId);
    if (!batch) throw new NotFoundError('Eval batch not found');
    const runs = await this.repo.listRunsForBatch(batchId);
    return {
      ...toEvalBatchDto(batch),
      runs: runs.map(toEvalRunDto),
    };
  }

  async listBatches(workspaceId: string, agentId: string, range: TimeRangeFilter) {
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const since = rangeToDate(range);
    const batches = await this.repo.listBatchesForOwner(workspaceId, agentId, since);
    return batches.map(toEvalBatchDto);
  }

  // ===========================================================================
  // Compare batches
  // ===========================================================================

  async compareBatches(workspaceId: string, batchIdA: string, batchIdB: string) {
    const [batchA, batchB] = await Promise.all([
      this.repo.getBatchScoped(workspaceId, batchIdA),
      this.repo.getBatchScoped(workspaceId, batchIdB),
    ]);
    if (!batchA) throw new NotFoundError(`Batch ${batchIdA} not found`);
    if (!batchB) throw new NotFoundError(`Batch ${batchIdB} not found`);

    const [runsResult] = [
      await this.repo.getRunsForBatches(batchIdA, batchIdB),
    ];
    const runsA = runsResult[0]?.runs ?? [];
    const runsB = runsResult[1]?.runs ?? [];

    // Load agent versions for system prompt diff
    const [versionA, versionB] = await Promise.all([
      this.agentsRepo.getVersion(batchA.ownerId, batchA.agentVersion),
      this.agentsRepo.getVersion(batchB.ownerId, batchB.agentVersion),
    ]);

    const configA = versionA?.configJson as AgentVersionConfig | undefined;
    const configB = versionB?.configJson as AgentVersionConfig | undefined;

    // Identify case flips between the two batches
    const runsByCaseA = new Map(runsA.map((r) => [r.caseId, r]));
    const runsByCaseB = new Map(runsB.map((r) => [r.caseId, r]));
    const allCaseIds = new Set([...runsByCaseA.keys(), ...runsByCaseB.keys()]);

    const caseFlips = [];
    for (const caseId of allCaseIds) {
      const runA = runsByCaseA.get(caseId);
      const runB = runsByCaseB.get(caseId);
      const passA = runA?.pass ?? null;
      const passB = runB?.pass ?? null;
      if (passA !== passB) {
        caseFlips.push({
          case_id: caseId,
          case_name: null as string | null,
          regression: passA === true && passB !== true,
          pass_a: passA,
          pass_b: passB,
        });
      }
    }

    const makeDelta = (a: number | null | undefined, b: number | null | undefined) => ({
      a: a ?? null,
      b: b ?? null,
      delta: a != null && b != null ? b - a : null,
    });

    const passRateA =
      batchA.tracesTotal && batchA.tracesTotal > 0
        ? (batchA.tracesPassed ?? 0) / batchA.tracesTotal
        : null;
    const passRateB =
      batchB.tracesTotal && batchB.tracesTotal > 0
        ? (batchB.tracesPassed ?? 0) / batchB.tracesTotal
        : null;

    return {
      batch_a: toEvalBatchDto(batchA),
      batch_b: toEvalBatchDto(batchB),
      recall: makeDelta(batchA.recall, batchB.recall),
      precision: makeDelta(batchA.precision, batchB.precision),
      citation_accuracy: makeDelta(batchA.citationAccuracy, batchB.citationAccuracy),
      pass_fraction: makeDelta(passRateA, passRateB),
      cost_usd: makeDelta(batchA.costUsd, batchB.costUsd),
      system_prompt_a: configA?.system_prompt ?? null,
      system_prompt_b: configB?.system_prompt ?? null,
      case_flips: caseFlips,
    };
  }

  // ===========================================================================
  // Version promotion
  // ===========================================================================

  /**
   * Promote a previous agent version — read that version's AgentVersionConfig
   * and apply it to the agent via AgentsService.update(), creating a new version (N+1).
   */
  async promoteVersion(workspaceId: string, agentId: string, version: number) {
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const versionRow = await this.agentsRepo.getVersion(agentId, version);
    if (!versionRow) throw new NotFoundError(`Agent version ${version} not found`);

    const config = versionRow.configJson as AgentVersionConfig;

    const updated = await this.agentsService.update(workspaceId, agentId, {
      provider: config.provider,
      model: config.model,
      system_prompt: config.system_prompt,
      output_schema: config.output_schema,
      strategy: config.strategy,
      ci_fail_on: config.ci_fail_on,
      repo_intel: config.repo_intel,
    });

    return updated;
  }

  // ===========================================================================
  // Dashboard
  // ===========================================================================

  async getWorkspaceDashboard(workspaceId: string) {
    const [agents, recentBatches] = await Promise.all([
      this.repo.getWorkspaceDashboardAgents(workspaceId),
      this.repo.getRecentBatchesForWorkspace(workspaceId),
    ]);

    return {
      agents: agents.map(({ agent, casesTotal, latestBatch }) => ({
        agent_id: agent.id,
        agent_name: agent.name,
        agent_version: agent.version,
        last_ran_at: latestBatch?.ranAt.toISOString() ?? null,
        cases_total: casesTotal,
        recall: latestBatch?.recall ?? null,
        precision: latestBatch?.precision ?? null,
        citation_accuracy: latestBatch?.citationAccuracy ?? null,
        traces_passed: latestBatch?.tracesPassed ?? null,
        traces_total: latestBatch?.tracesTotal ?? null,
        latest_status: (latestBatch?.status as 'queued' | 'running' | 'done' | 'failed' | null) ?? null,
      })),
      recent_batches: recentBatches.map((b) => ({
        ...toEvalBatchDto(b),
        agent_name: b.agentName,
      })),
    };
  }

  async getAgentDashboard(workspaceId: string, agentId: string, range: TimeRangeFilter) {
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const since = rangeToDate(range);
    const [batches, cases] = await Promise.all([
      this.repo.listBatchesForOwner(workspaceId, agentId, since),
      this.repo.listCasesForOwner(workspaceId, agentId),
    ]);

    const latestBatch = batches[batches.length - 1];
    const prevBatch = batches[batches.length - 2];

    const current = latestBatch
      ? {
          recall: latestBatch.recall ?? 0,
          precision: latestBatch.precision ?? 0,
          citation_accuracy: latestBatch.citationAccuracy ?? 0,
          traces_passed: latestBatch.tracesPassed ?? 0,
          traces_total: latestBatch.tracesTotal ?? 0,
          cost_usd: latestBatch.costUsd ?? null,
        }
      : {
          recall: 0,
          precision: 0,
          citation_accuracy: 0,
          traces_passed: 0,
          traces_total: 0,
          cost_usd: null,
        };

    const delta = {
      recall: (latestBatch?.recall ?? 0) - (prevBatch?.recall ?? 0),
      precision: (latestBatch?.precision ?? 0) - (prevBatch?.precision ?? 0),
      citation_accuracy:
        (latestBatch?.citationAccuracy ?? 0) - (prevBatch?.citationAccuracy ?? 0),
    };

    const trend = batches.map((b) => ({
      ran_at: b.ranAt.toISOString(),
      recall: b.recall ?? 0,
      precision: b.precision ?? 0,
      citation_accuracy: b.citationAccuracy ?? 0,
      pass_rate:
        b.tracesTotal && b.tracesTotal > 0 ? (b.tracesPassed ?? 0) / b.tracesTotal : 0,
      cost_usd: b.costUsd ?? null,
    }));

    // Alert when latest batch shows a regression
    let alert: string | null = null;
    if (prevBatch && latestBatch) {
      const precisionDelta = (latestBatch.precision ?? 0) - (prevBatch.precision ?? 0);
      const recallDelta = (latestBatch.recall ?? 0) - (prevBatch.recall ?? 0);
      if (precisionDelta < -0.02) {
        alert = `Precision dipped ${Math.abs(Math.round(precisionDelta * 100))}pts on v${latestBatch.agentVersion}`;
      } else if (recallDelta < -0.02) {
        alert = `Recall dipped ${Math.abs(Math.round(recallDelta * 100))}pts on v${latestBatch.agentVersion}`;
      }
    }

    return {
      owner_kind: 'agent' as const,
      owner_id: agentId,
      cases_total: cases.length,
      current,
      delta,
      trend,
      recent_runs: batches.slice(-10).map(toEvalBatchDto),
      alert,
    };
  }

  // ===========================================================================
  // Boot-time stale batch reaping
  // ===========================================================================

  async reapStaleBatches(): Promise<number> {
    return this.repo.reapStaleBatches();
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function rangeToDate(range: TimeRangeFilter): Date | undefined {
  if (range === 'all') return undefined;
  const now = new Date();
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
