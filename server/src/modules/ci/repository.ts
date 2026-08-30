import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * A6 — ci data-access. Owns `ci_installations` and `ci_runs`.
 * Workspace-scoped for all queries that have a workspace context.
 * Ingest queries (findInstallationByRepo, upsertCiRun) are scoped by
 * installation id (derived from the matched installation).
 */

export interface InsertInstallationInput {
  agentId: string;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  agentVersion?: number;
}

export interface InsertAgentRunInput {
  workspaceId: string;
  agentId: string;
  agentName: string;
  model?: string | null;
  provider?: string | null;
  durationMs?: number | null;
  costUsd?: number | null;
  status?: string | null;
  findingsCount?: number | null;
}

export interface UpsertCiRunInput {
  ciInstallationId: string;
  prNumber?: number | null;
  commitSha?: string | null;
  model?: string | null;
  manifestVersion?: string | null;
  status?: string | null;
  findingsCount?: number | null;
  costUsd?: number | null;
  githubUrl?: string | null;
}

export interface ListRunsFilters {
  workspaceId?: string;
  repo?: string;
  agentId?: string;
  status?: string;
}

// ---- Agent Performance dashboard (v2) --------------------------------------

export interface AgentRunAggRow {
  agentId: string;
  agentName: string;
  runs: number;
  totalCostUsd: number;
  avgCostUsd: number | null;
  avgDurationMs: number | null;
  lastRanAt: string | null;
}

export interface WindowTotals {
  totalRuns: number;
  totalCostUsd: number;
}

export interface ModelCostRow {
  model: string;
  costUsd: number;
}

export interface AcceptCountsRow {
  agentId: string;
  accepted: number;
  dismissed: number;
}

export interface InstallationWithLatestRun {
  installation: typeof t.ciInstallations.$inferSelect;
  lastStatus: string | null;
  lastRunAt: string | null;
}

export class CiRepository {
  constructor(private db: Db) {}

  // ---- ci_installations ----------------------------------------------------

  async insertInstallation(
    input: InsertInstallationInput,
  ): Promise<typeof t.ciInstallations.$inferSelect> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        agentId: input.agentId,
        repo: input.repo,
        targetType: input.targetType,
        agentVersion: input.agentVersion ?? null,
      })
      .returning();
    return row!;
  }

  /**
   * Insert a new installation, or update the existing row for the same
   * `(agentId, repo)` pair — Add-repository for an already-installed repo
   * must result in an update, never a duplicate row (AC-UN7).
   */
  async upsertInstallation(
    input: InsertInstallationInput,
  ): Promise<typeof t.ciInstallations.$inferSelect> {
    const [existing] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(
        and(eq(t.ciInstallations.agentId, input.agentId), eq(t.ciInstallations.repo, input.repo)),
      );

    if (existing) {
      const [updated] = await this.db
        .update(t.ciInstallations)
        .set({
          targetType: input.targetType,
          agentVersion: input.agentVersion ?? existing.agentVersion,
        })
        .where(eq(t.ciInstallations.id, existing.id))
        .returning();
      return updated!;
    }

    return this.insertInstallation(input);
  }

  /** Find an installation by repo string. Used by ingest to match an incoming artifact. */
  async findInstallationByRepo(
    repo: string,
  ): Promise<typeof t.ciInstallations.$inferSelect | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.repo, repo));
    return row;
  }

  /**
   * Look up the workspace ID and name for an agent, used by ingest which has
   * no workspace context (it authenticates via CI_INGEST_TOKEN instead of
   * getContext). The name is required by agent_runs.agent_name (NOT NULL).
   * Returns undefined if the agent doesn't exist.
   */
  async getWorkspaceAndNameForAgent(
    agentId: string,
  ): Promise<{ workspaceId: string; agentName: string } | undefined> {
    const [row] = await this.db
      .select({ workspaceId: t.agents.workspaceId, agentName: t.agents.name })
      .from(t.agents)
      .where(eq(t.agents.id, agentId));
    return row;
  }

  // ---- ci_runs ------------------------------------------------------------

  /**
   * List CI runs, optionally filtered.
   * Joins ci_installations → agents for repo/agent columns.
   */
  async listRuns(filters: ListRunsFilters): Promise<
    {
      run: typeof t.ciRuns.$inferSelect;
      installation: typeof t.ciInstallations.$inferSelect | null;
      agent: typeof t.agents.$inferSelect | null;
    }[]
  > {
    const conditions = [];

    if (filters.workspaceId) {
      conditions.push(eq(t.agents.workspaceId, filters.workspaceId));
    }
    if (filters.status) {
      conditions.push(eq(t.ciRuns.status, filters.status));
    }
    if (filters.repo) {
      conditions.push(eq(t.ciInstallations.repo, filters.repo));
    }
    if (filters.agentId) {
      conditions.push(eq(t.ciInstallations.agentId, filters.agentId));
    }

    return this.db
      .select({
        run: t.ciRuns,
        installation: t.ciInstallations,
        agent: t.agents,
      })
      .from(t.ciRuns)
      .leftJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .leftJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);
  }

  /** Insert an agent_runs row with source='ci'. */
  async insertAgentRun(
    input: InsertAgentRunInput,
  ): Promise<typeof t.agentRuns.$inferSelect> {
    const [row] = await this.db
      .insert(t.agentRuns)
      .values({
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        agentName: input.agentName,
        source: 'ci',
        model: input.model ?? null,
        provider: input.provider ?? null,
        durationMs: input.durationMs ?? null,
        costUsd: input.costUsd ?? null,
        status: input.status ?? null,
        findingsCount: input.findingsCount ?? null,
      })
      .returning();
    return row!;
  }

  /**
   * Upsert a ci_runs row keyed on (ci_installation_id, pr_number, commit_sha).
   *
   * To avoid a TOCTOU double-insert under concurrent replays, this is implemented
   * as a transactional find-then-insert-or-update. A DB-level partial unique index
   * on (ci_installation_id, pr_number, commit_sha) is the more robust option and
   * is noted as a hardening follow-up.
   */
  async upsertCiRun(
    input: UpsertCiRunInput,
  ): Promise<typeof t.ciRuns.$inferSelect> {
    return this.db.transaction(async (tx) => {
      // Look for an existing row matching the dedup key
      const conditions = [eq(t.ciRuns.ciInstallationId, input.ciInstallationId)];
      if (input.prNumber != null) {
        conditions.push(eq(t.ciRuns.prNumber, input.prNumber));
      }
      if (input.commitSha != null) {
        conditions.push(eq(t.ciRuns.commitSha, input.commitSha));
      }

      const [existing] = await tx
        .select()
        .from(t.ciRuns)
        .where(and(...conditions))
        .for('update');

      if (existing) {
        // Update the existing row with fresh provenance
        const [updated] = await tx
          .update(t.ciRuns)
          .set({
            model: input.model ?? existing.model,
            manifestVersion: input.manifestVersion ?? existing.manifestVersion,
            status: input.status ?? existing.status,
            findingsCount: input.findingsCount ?? existing.findingsCount,
            costUsd: input.costUsd ?? existing.costUsd,
            githubUrl: input.githubUrl ?? existing.githubUrl,
            ranAt: new Date(),
          })
          .where(eq(t.ciRuns.id, existing.id))
          .returning();
        return updated!;
      }

      // Insert a new row
      const [inserted] = await tx
        .insert(t.ciRuns)
        .values({
          ciInstallationId: input.ciInstallationId,
          prNumber: input.prNumber ?? null,
          commitSha: input.commitSha ?? null,
          model: input.model ?? null,
          manifestVersion: input.manifestVersion ?? null,
          status: input.status ?? null,
          findingsCount: input.findingsCount ?? null,
          costUsd: input.costUsd ?? null,
          githubUrl: input.githubUrl ?? null,
          source: 'ci',
          ranAt: new Date(),
        })
        .returning();
      return inserted!;
    });
  }

  // ===========================================================================
  // Agent Performance dashboard (v2) — parameterized, window-bounded, GROUP BY
  // ===========================================================================

  /**
   * Per-agent aggregation of `agent_runs` (both `source` values counted) over
   * `[since, until)` — AC-U2. `agent_name` is the name captured on the most
   * recently-run row in-window (robust to mid-window renames).
   */
  async aggregateAgentRuns(
    workspaceId: string,
    since: Date,
    until: Date,
  ): Promise<AgentRunAggRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        agent_id,
        (array_agg(agent_name ORDER BY ran_at DESC))[1] AS agent_name,
        count(*) AS runs,
        coalesce(sum(cost_usd), 0) AS total_cost_usd,
        avg(cost_usd) AS avg_cost_usd,
        avg(duration_ms) AS avg_duration_ms,
        max(ran_at) AS last_ran_at
      FROM agent_runs
      WHERE workspace_id = ${workspaceId}
        AND agent_id IS NOT NULL
        AND ran_at >= ${since.toISOString()}
        AND ran_at < ${until.toISOString()}
      GROUP BY agent_id
    `);

    const RowSchema = z.object({
      agent_id: z.string(),
      agent_name: z.string(),
      runs: z.coerce.number().int(),
      total_cost_usd: z.coerce.number(),
      avg_cost_usd: z.coerce.number().nullable(),
      avg_duration_ms: z.coerce.number().nullable(),
      last_ran_at: z.coerce.date().nullable(),
    });

    const result: AgentRunAggRow[] = [];
    for (const row of rows) {
      const parsed = RowSchema.safeParse(row);
      if (!parsed.success) continue;
      result.push({
        agentId: parsed.data.agent_id,
        agentName: parsed.data.agent_name,
        runs: parsed.data.runs,
        totalCostUsd: parsed.data.total_cost_usd,
        avgCostUsd: parsed.data.avg_cost_usd,
        avgDurationMs: parsed.data.avg_duration_ms,
        lastRanAt: parsed.data.last_ran_at ? parsed.data.last_ran_at.toISOString() : null,
      });
    }
    return result;
  }

  /** Totals across all `agent_runs` (both `source` values) in `[since, until)` — AC-U2. */
  async totalsForWindow(workspaceId: string, since: Date, until: Date): Promise<WindowTotals> {
    const rows = await this.db.execute(sql`
      SELECT count(*) AS total_runs, coalesce(sum(cost_usd), 0) AS total_cost_usd
      FROM agent_runs
      WHERE workspace_id = ${workspaceId}
        AND ran_at >= ${since.toISOString()}
        AND ran_at < ${until.toISOString()}
    `);

    const RowSchema = z.object({
      total_runs: z.coerce.number().int(),
      total_cost_usd: z.coerce.number(),
    });
    const parsed = RowSchema.safeParse(rows[0]);
    if (!parsed.success) return { totalRuns: 0, totalCostUsd: 0 };
    return { totalRuns: parsed.data.total_runs, totalCostUsd: parsed.data.total_cost_usd };
  }

  /** Cost grouped by model over `[since, until)` — feeds the by-model cost donut. */
  async costByModel(workspaceId: string, since: Date, until: Date): Promise<ModelCostRow[]> {
    const rows = await this.db.execute(sql`
      SELECT coalesce(model, 'unknown') AS model, coalesce(sum(cost_usd), 0) AS cost_usd
      FROM agent_runs
      WHERE workspace_id = ${workspaceId}
        AND ran_at >= ${since.toISOString()}
        AND ran_at < ${until.toISOString()}
      GROUP BY coalesce(model, 'unknown')
    `);

    const RowSchema = z.object({ model: z.string(), cost_usd: z.coerce.number() });
    const result: ModelCostRow[] = [];
    for (const row of rows) {
      const parsed = RowSchema.safeParse(row);
      if (!parsed.success) continue;
      result.push({ model: parsed.data.model, costUsd: parsed.data.cost_usd });
    }
    return result;
  }

  /**
   * Per-agent accepted/dismissed counts from local review findings, windowed
   * by `reviews.created_at` (`findings` has no own timestamp) — AC-U3. Accept
   * rate itself (null when accepted+dismissed===0) is derived in `helpers.ts`
   * (AC-UN8, no divide-by-zero).
   */
  async acceptCountsByAgent(
    workspaceId: string,
    since: Date,
    until: Date,
  ): Promise<AcceptCountsRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        reviews.agent_id AS agent_id,
        count(*) FILTER (WHERE findings.accepted_at IS NOT NULL) AS accepted,
        count(*) FILTER (WHERE findings.dismissed_at IS NOT NULL) AS dismissed
      FROM findings
      INNER JOIN reviews ON reviews.id = findings.review_id
      WHERE reviews.workspace_id = ${workspaceId}
        AND reviews.agent_id IS NOT NULL
        AND reviews.created_at >= ${since.toISOString()}
        AND reviews.created_at < ${until.toISOString()}
      GROUP BY reviews.agent_id
    `);

    const RowSchema = z.object({
      agent_id: z.string(),
      accepted: z.coerce.number().int(),
      dismissed: z.coerce.number().int(),
    });
    const result: AcceptCountsRow[] = [];
    for (const row of rows) {
      const parsed = RowSchema.safeParse(row);
      if (!parsed.success) continue;
      result.push({
        agentId: parsed.data.agent_id,
        accepted: parsed.data.accepted,
        dismissed: parsed.data.dismissed,
      });
    }
    return result;
  }

  // ===========================================================================
  // Multi-repo installations (v2)
  // ===========================================================================

  /**
   * List installations for an agent with the latest `ci_runs` status/time
   * joined in (LATERAL join, no new columns) — AC-E3, AC-U5.
   *
   * `ci_installations` has no direct `workspace_id` column, so ownership is
   * verified via a join to `agents` (multi-tenant isolation) — mirrors
   * `deleteInstallation`'s pattern. Without this, `agent_id` was the only
   * scoping key, letting a caller enumerate any workspace's installations by
   * guessing/observing a UUID (cross-workspace IDOR).
   */
  async listInstallationsWithLatestRun(
    workspaceId: string,
    agentId: string,
  ): Promise<InstallationWithLatestRun[]> {
    const rows = await this.db.execute(sql`
      SELECT
        i.id, i.agent_id, i.repo, i.target_type, i.installed_at, i.agent_version,
        r.status AS last_status, r.ran_at AS last_run_at
      FROM ci_installations i
      INNER JOIN agents a ON a.id = i.agent_id
      LEFT JOIN LATERAL (
        SELECT status, ran_at
        FROM ci_runs
        WHERE ci_runs.ci_installation_id = i.id
        ORDER BY ran_at DESC NULLS LAST
        LIMIT 1
      ) r ON true
      WHERE i.agent_id = ${agentId} AND a.workspace_id = ${workspaceId}
      ORDER BY i.installed_at DESC
    `);

    const RowSchema = z.object({
      id: z.string(),
      agent_id: z.string(),
      repo: z.string(),
      target_type: z.enum(['gha', 'circle', 'jenkins', 'cli']),
      installed_at: z.coerce.date(),
      agent_version: z.coerce.number().nullable(),
      last_status: z.string().nullable(),
      last_run_at: z.coerce.date().nullable(),
    });

    const result: InstallationWithLatestRun[] = [];
    for (const row of rows) {
      const parsed = RowSchema.safeParse(row);
      if (!parsed.success) continue;
      result.push({
        installation: {
          id: parsed.data.id,
          agentId: parsed.data.agent_id,
          repo: parsed.data.repo,
          targetType: parsed.data.target_type,
          installedAt: parsed.data.installed_at,
          agentVersion: parsed.data.agent_version,
        },
        lastStatus: parsed.data.last_status,
        lastRunAt: parsed.data.last_run_at ? parsed.data.last_run_at.toISOString() : null,
      });
    }
    return result;
  }

  /**
   * Delete an installation scoped by workspace — `ci_installations` has no
   * direct `workspace_id` column, so ownership is verified via a join to
   * `agents` (multi-tenant isolation) before the delete. `ci_runs` rows are
   * preserved via the existing `ON DELETE SET NULL` FK (AC-E5).
   */
  async deleteInstallation(id: string, workspaceId: string): Promise<boolean> {
    const [owned] = await this.db
      .select({ id: t.ciInstallations.id })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.ciInstallations.id, id), eq(t.agents.workspaceId, workspaceId)));
    if (!owned) return false;

    const rows = await this.db
      .delete(t.ciInstallations)
      .where(eq(t.ciInstallations.id, id))
      .returning({ id: t.ciInstallations.id });
    return rows.length > 0;
  }
}
