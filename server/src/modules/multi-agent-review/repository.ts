import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConflictFinding } from './conflict.js';
import type { MultiAgentAgentColumn } from '@devdigest/shared';

/**
 * Data access for the multi-agent-review module.
 * All queries are workspace-scoped. No Drizzle operators in the service layer —
 * all DB interactions go through this repository.
 */
export class MultiAgentReviewRepository {
  constructor(private db: Db) {}

  // ---- multi_agent_runs CRUD -----------------------------------------------

  /** Insert a new multi_agent_runs row and return its ID. */
  async createMultiAgentRun(workspaceId: string, prId: string): Promise<string> {
    const [row] = await this.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId })
      .returning({ id: t.multiAgentRuns.id });
    return row!.id;
  }

  /** Fetch a multi_agent_runs row, workspace-scoped. Returns undefined if not found. */
  async getMultiAgentRun(
    workspaceId: string,
    multiAgentRunId: string,
  ): Promise<typeof t.multiAgentRuns.$inferSelect | undefined> {
    const [row] = await this.db
      .select()
      .from(t.multiAgentRuns)
      .where(
        and(
          eq(t.multiAgentRuns.id, multiAgentRunId),
          eq(t.multiAgentRuns.workspaceId, workspaceId),
        ),
      );
    return row;
  }

  // ---- agent_runs for a multi-agent run ------------------------------------

  /**
   * Fetch all agent_runs for a multi-agent run, joined with reviews + findings.
   * Uses agent_runs.agent_name directly — survives agent deletion (edge case 5).
   * Returns shaped MultiAgentAgentColumn[] ready for the response.
   */
  async getRunsForMultiAgent(multiAgentRunId: string): Promise<MultiAgentAgentColumn[]> {
    // Fetch agent_runs rows for this multi-agent run
    const runs = await this.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.multiAgentRunId, multiAgentRunId));

    if (runs.length === 0) return [];

    const columns: MultiAgentAgentColumn[] = [];

    for (const run of runs) {
      // Fetch the review for this run (if any completed)
      const reviews = await this.db
        .select()
        .from(t.reviews)
        .where(eq(t.reviews.runId, run.id));

      const review = reviews[0] ?? null;

      // Fetch findings if there is a review
      const findings =
        review !== null
          ? await this.db
              .select({
                id: t.findings.id,
                severity: t.findings.severity,
                category: t.findings.category,
                title: t.findings.title,
                file: t.findings.file,
                start_line: t.findings.startLine,
                kind: t.findings.kind,
              })
              .from(t.findings)
              .where(eq(t.findings.reviewId, review.id))
          : [];

      const status = normalizeStatus(run.status);

      columns.push({
        run_id: run.id,
        agent_id: run.agentId ?? '',
        agent_name: run.agentName,
        provider: run.provider,
        model: run.model,
        status,
        verdict: review?.verdict ?? null,
        score: run.score ?? null,
        summary: review?.summary ?? null,
        duration_ms: run.durationMs ?? null,
        cost_usd: run.costUsd ?? null,
        tokens_in: run.tokensIn ?? null,
        tokens_out: run.tokensOut ?? null,
        findings: findings.map((f) => ({
          id: f.id,
          severity: f.severity as MultiAgentAgentColumn['findings'][number]['severity'],
          category: f.category,
          title: f.title,
          file: f.file,
          start_line: f.start_line,
          kind: f.kind,
        })),
      });
    }

    return columns;
  }

  /**
   * Fetch raw findings for conflict computation.
   * Includes end_line (absent from AgentColumnFinding contract) and agent info.
   * Returns ConflictFinding[] for use by computeConflicts().
   */
  async getFindingsForConflict(multiAgentRunId: string): Promise<ConflictFinding[]> {
    const rows = await this.db
      .select({
        agentRunId: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        agentName: t.agentRuns.agentName,
        file: t.findings.file,
        startLine: t.findings.startLine,
        endLine: t.findings.endLine,
        severity: t.findings.severity,
        category: t.findings.category,
        title: t.findings.title,
      })
      .from(t.agentRuns)
      .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(eq(t.agentRuns.multiAgentRunId, multiAgentRunId));

    return rows.map((r) => ({
      agent_id: r.agentId ?? '',
      agent_name: r.agentName,
      file: r.file,
      start_line: r.startLine,
      end_line: r.endLine,
      severity: r.severity,
      category: r.category,
      title: r.title,
    }));
  }

  // ---- estimates -----------------------------------------------------------

  /**
   * Batch: most recent completed agent_run per agent for the workspace.
   * Used for pre-run estimate computation.
   * Returns a map of agent_id → { cost_usd, duration_ms }.
   */
  async getLatestCompletedRuns(
    workspaceId: string,
  ): Promise<Map<string, { cost_usd: number | null; duration_ms: number | null }>> {
    // Use a DISTINCT ON query to get the latest completed run per agent.
    // db.execute() with postgres-js returns a RowList<Row[]> which is directly iterable.
    const rows = await this.db.execute(
      sql`
        SELECT DISTINCT ON (agent_id)
          agent_id,
          cost_usd,
          duration_ms
        FROM agent_runs
        WHERE workspace_id = ${workspaceId}
          AND status = 'done'
          AND agent_id IS NOT NULL
        ORDER BY agent_id, ran_at DESC
      `,
    );

    const RowSchema = z.object({
      agent_id: z.string(),
      cost_usd: z.number().nullable(),
      duration_ms: z.number().nullable(),
    });

    const result = new Map<string, { cost_usd: number | null; duration_ms: number | null }>();
    for (const row of rows) {
      const parsed = RowSchema.safeParse(row);
      if (!parsed.success) continue;
      result.set(parsed.data.agent_id, {
        cost_usd: parsed.data.cost_usd,
        duration_ms: parsed.data.duration_ms,
      });
    }
    return result;
  }
}

/** Normalize a raw DB status string to the AgentColumn status enum. */
function normalizeStatus(status: string | null): 'done' | 'failed' | 'running' {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  return 'running';
}
