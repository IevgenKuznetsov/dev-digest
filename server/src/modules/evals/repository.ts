/**
 * Eval Pipeline — data-access layer.
 *
 * Owns eval_cases, eval_runs, and eval_batches tables. All methods are
 * workspace-scoped. eval_batches has no workspace_id column, so workspace
 * scoping is done via JOIN agents ON eval_batches.owner_id = agents.id.
 */

import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;
export type EvalBatchRow = typeof t.evalBatches.$inferSelect;

export class EvalRepository {
  constructor(private db: Db) {}

  // ===========================================================================
  // Eval Cases
  // ===========================================================================

  async createCase(values: {
    workspaceId: string;
    ownerKind: 'skill' | 'agent';
    ownerId: string;
    name: string;
    inputDiff?: string;
    inputFiles?: unknown;
    inputMeta?: unknown;
    expectedOutput: unknown[];
    notes?: string | null;
    sourceFindingId?: string | null;
  }): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff ?? '',
        inputFiles: (values.inputFiles as object | null) ?? null,
        inputMeta: (values.inputMeta as object | null) ?? null,
        expectedOutput: values.expectedOutput as object[],
        notes: values.notes ?? null,
        sourceFindingId: values.sourceFindingId ?? null,
      })
      .returning();
    return row!;
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.id, caseId), eq(t.evalCases.workspaceId, workspaceId)));
    return row;
  }

  async listCasesForOwner(workspaceId: string, ownerId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, ownerId)));
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: {
      name?: string;
      inputDiff?: string;
      inputFiles?: unknown;
      inputMeta?: unknown;
      expectedOutput?: unknown[];
      notes?: string | null;
      sourceFindingId?: string | null;
    },
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles as object } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object } : {}),
        ...(patch.expectedOutput !== undefined
          ? { expectedOutput: patch.expectedOutput as object[] }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.sourceFindingId !== undefined
          ? { sourceFindingId: patch.sourceFindingId }
          : {}),
      })
      .where(and(eq(t.evalCases.id, caseId), eq(t.evalCases.workspaceId, workspaceId)))
      .returning();
    return row;
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.id, caseId), eq(t.evalCases.workspaceId, workspaceId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ===========================================================================
  // Eval Batches
  // ===========================================================================

  async createBatch(values: {
    ownerId: string;
    ownerKind: 'agent';
    agentVersion: number;
    status: 'queued' | 'running' | 'done' | 'failed';
  }): Promise<EvalBatchRow> {
    const [row] = await this.db
      .insert(t.evalBatches)
      .values({
        ownerId: values.ownerId,
        ownerKind: values.ownerKind,
        agentVersion: values.agentVersion,
        status: values.status,
      })
      .returning();
    return row!;
  }

  async getBatch(batchId: string): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalBatches)
      .where(eq(t.evalBatches.id, batchId));
    return row;
  }

  /** Get batch by ID, scoped to a workspace via JOIN agents. */
  async getBatchScoped(
    workspaceId: string,
    batchId: string,
  ): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .select({ batch: t.evalBatches })
      .from(t.evalBatches)
      .innerJoin(t.agents, eq(t.evalBatches.ownerId, t.agents.id))
      .where(and(eq(t.evalBatches.id, batchId), eq(t.agents.workspaceId, workspaceId)));
    return row?.batch;
  }

  async updateBatch(
    batchId: string,
    patch: {
      status?: 'queued' | 'running' | 'done' | 'failed';
      recall?: number | null;
      precision?: number | null;
      citationAccuracy?: number | null;
      tracesTotal?: number | null;
      tracesPassed?: number | null;
      costUsd?: number | null;
      durationMs?: number | null;
    },
  ): Promise<void> {
    await this.db
      .update(t.evalBatches)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.recall !== undefined ? { recall: patch.recall } : {}),
        ...(patch.precision !== undefined ? { precision: patch.precision } : {}),
        ...(patch.citationAccuracy !== undefined
          ? { citationAccuracy: patch.citationAccuracy }
          : {}),
        ...(patch.tracesTotal !== undefined ? { tracesTotal: patch.tracesTotal } : {}),
        ...(patch.tracesPassed !== undefined ? { tracesPassed: patch.tracesPassed } : {}),
        ...(patch.costUsd !== undefined ? { costUsd: patch.costUsd } : {}),
        ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
      })
      .where(eq(t.evalBatches.id, batchId));
  }

  async listBatchesForOwner(
    workspaceId: string,
    ownerId: string,
    since?: Date,
  ): Promise<EvalBatchRow[]> {
    const rows = await this.db
      .select({ batch: t.evalBatches })
      .from(t.evalBatches)
      .innerJoin(t.agents, eq(t.evalBatches.ownerId, t.agents.id))
      .where(
        and(
          eq(t.evalBatches.ownerId, ownerId),
          eq(t.agents.workspaceId, workspaceId),
          ...(since ? [gte(t.evalBatches.ranAt, since)] : []),
        ),
      )
      .orderBy(t.evalBatches.ranAt);
    return rows.map((r) => r.batch);
  }

  /** Returns the active (queued or running) batch for an agent, if any. */
  async getActiveBatchForOwner(ownerId: string): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalBatches)
      .where(
        and(
          eq(t.evalBatches.ownerId, ownerId),
          or(eq(t.evalBatches.status, 'queued'), eq(t.evalBatches.status, 'running')),
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * Reap stale batches — set any 'running' or 'queued' batches to 'failed'.
   * Called on server boot following the existing pattern for agent_runs.
   */
  async reapStaleBatches(): Promise<number> {
    const rows = await this.db
      .update(t.evalBatches)
      .set({ status: 'failed' })
      .where(or(eq(t.evalBatches.status, 'running'), eq(t.evalBatches.status, 'queued')))
      .returning({ id: t.evalBatches.id });
    return rows.length;
  }

  // ===========================================================================
  // Eval Runs
  // ===========================================================================

  async createRun(values: {
    caseId: string;
    batchId?: string | null;
    actualOutput?: unknown;
    pass?: boolean | null;
    citationAccuracy?: number | null;
    durationMs?: number | null;
    costUsd?: number | null;
    error?: string | null;
  }): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        batchId: values.batchId ?? null,
        actualOutput: (values.actualOutput as object | null) ?? null,
        pass: values.pass ?? null,
        citationAccuracy: values.citationAccuracy ?? null,
        durationMs: values.durationMs ?? null,
        costUsd: values.costUsd ?? null,
        error: values.error ?? null,
      })
      .returning();
    return row!;
  }

  async listRunsForBatch(batchId: string): Promise<EvalRunRow[]> {
    return this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.batchId, batchId))
      .orderBy(t.evalRuns.ranAt);
  }

  async listRunsForCase(caseId: string): Promise<EvalRunRow[]> {
    return this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.caseId, caseId))
      .orderBy(t.evalRuns.ranAt);
  }

  async getRunsForBatches(
    batchIdA: string,
    batchIdB: string,
  ): Promise<{ batchId: string; runs: EvalRunRow[] }[]> {
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.batchId, [batchIdA, batchIdB]))
      .orderBy(t.evalRuns.ranAt);

    const byBatch = new Map<string, EvalRunRow[]>();
    for (const row of rows) {
      const bid = row.batchId ?? '';
      if (!byBatch.has(bid)) byBatch.set(bid, []);
      byBatch.get(bid)!.push(row);
    }

    return [
      { batchId: batchIdA, runs: byBatch.get(batchIdA) ?? [] },
      { batchId: batchIdB, runs: byBatch.get(batchIdB) ?? [] },
    ];
  }

  // ===========================================================================
  // Dashboard queries
  // ===========================================================================

  /**
   * Get all agents in a workspace with their latest batch stats.
   */
  async getWorkspaceDashboardAgents(
    workspaceId: string,
  ): Promise<
    {
      agent: typeof t.agents.$inferSelect;
      casesTotal: number;
      latestBatch: EvalBatchRow | undefined;
    }[]
  > {
    const agentRows = await this.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));

    const results = await Promise.all(
      agentRows.map(async (agent) => {
        const [latestBatch] = await this.db
          .select()
          .from(t.evalBatches)
          .where(eq(t.evalBatches.ownerId, agent.id))
          .orderBy(desc(t.evalBatches.ranAt))
          .limit(1);

        const cases = await this.db
          .select({ id: t.evalCases.id })
          .from(t.evalCases)
          .where(
            and(
              eq(t.evalCases.workspaceId, workspaceId),
              eq(t.evalCases.ownerId, agent.id),
            ),
          );

        return {
          agent,
          casesTotal: cases.length,
          latestBatch: latestBatch as EvalBatchRow | undefined,
        };
      }),
    );

    return results;
  }

  /**
   * Get recent batches across all agents in a workspace.
   */
  async getRecentBatchesForWorkspace(
    workspaceId: string,
    limit = 20,
  ): Promise<(EvalBatchRow & { agentName: string })[]> {
    const rows = await this.db
      .select({ batch: t.evalBatches, agentName: t.agents.name })
      .from(t.evalBatches)
      .innerJoin(t.agents, eq(t.evalBatches.ownerId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(desc(t.evalBatches.ranAt))
      .limit(limit);

    return rows.map((r) => ({ ...r.batch, agentName: r.agentName }));
  }
}
