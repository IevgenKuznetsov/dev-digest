import { and, eq } from 'drizzle-orm';
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

  async listInstallations(
    agentId: string,
  ): Promise<(typeof t.ciInstallations.$inferSelect)[]> {
    return this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
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
   * Look up the workspace ID for an agent, used by ingest which has no workspace
   * context (it authenticates via CI_INGEST_TOKEN instead of getContext).
   * Returns undefined if the agent doesn't exist.
   */
  async getWorkspaceIdForAgent(agentId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ workspaceId: t.agents.workspaceId })
      .from(t.agents)
      .where(eq(t.agents.id, agentId));
    return row?.workspaceId;
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
}
