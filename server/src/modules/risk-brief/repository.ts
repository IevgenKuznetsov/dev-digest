import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Brief, BriefSources } from '@devdigest/shared';

/** DTO returned by repository methods — maps DB columns to API-ready shape. */
export interface RiskBriefRow {
  prId: string;
  headSha: string;
  brief: Brief;
  model: string;
  sources: BriefSources | null;
  generated_at: string; // ISO 8601 string (mapped from createdAt Date)
}

export class RiskBriefRepository {
  constructor(private db: Db) {}

  /**
   * Get the most recent brief for a PR (any head_sha), ordered by created_at DESC.
   * Returns null if no brief exists.
   * Used by GET to return the cached brief even when head_sha has changed (stale state).
   */
  async getLatestByPrId(prId: string): Promise<RiskBriefRow | null> {
    const rows = await this.db
      .select()
      .from(t.prRiskBrief)
      .where(eq(t.prRiskBrief.prId, prId))
      .orderBy(desc(t.prRiskBrief.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapRow(row);
  }

  /**
   * Get a brief by exact (prId, headSha) composite key.
   * Returns null if not found.
   */
  async getByPrIdAndSha(prId: string, headSha: string): Promise<RiskBriefRow | null> {
    const rows = await this.db
      .select()
      .from(t.prRiskBrief)
      .where(and(eq(t.prRiskBrief.prId, prId), eq(t.prRiskBrief.headSha, headSha)));
    const row = rows[0];
    if (!row) return null;
    return mapRow(row);
  }

  /**
   * Upsert a brief. On conflict (prId, headSha), updates brief, model, sources, createdAt.
   * Returns the upserted row as a DTO.
   */
  async upsert(
    prId: string,
    headSha: string,
    data: { brief: Brief; model: string; sources: BriefSources },
  ): Promise<RiskBriefRow> {
    const rows = await this.db
      .insert(t.prRiskBrief)
      .values({
        prId,
        headSha,
        brief: data.brief,
        model: data.model,
        sources: data.sources,
      })
      .onConflictDoUpdate({
        target: [t.prRiskBrief.prId, t.prRiskBrief.headSha],
        set: {
          brief: data.brief,
          model: data.model,
          sources: data.sources,
          createdAt: sql`now()`,
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Upsert returned no rows');
    return mapRow(row);
  }

  /**
   * Get a pull request row, verifying it belongs to the given workspace.
   * Returns the PR row or null if not found/unauthorized.
   */
  async getPrForWorkspace(
    workspaceId: string,
    prId: string,
  ): Promise<{
    id: string;
    headSha: string;
    additions: number;
    deletions: number;
    filesCount: number;
    body: string | null;
    repoId: string;
    repoOwner: string;
    repoName: string;
  } | null> {
    const rows = await this.db
      .select({
        id: t.pullRequests.id,
        headSha: t.pullRequests.headSha,
        additions: t.pullRequests.additions,
        deletions: t.pullRequests.deletions,
        filesCount: t.pullRequests.filesCount,
        body: t.pullRequests.body,
        repoId: t.pullRequests.repoId,
        repoOwner: t.repos.owner,
        repoName: t.repos.name,
      })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.pullRequests.repoId, t.repos.id))
      .where(
        and(
          eq(t.pullRequests.id, prId),
          eq(t.pullRequests.workspaceId, workspaceId),
        ),
      );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      headSha: row.headSha,
      additions: row.additions,
      deletions: row.deletions,
      filesCount: row.filesCount,
      body: row.body ?? null,
      repoId: row.repoId,
      repoOwner: row.repoOwner,
      repoName: row.repoName,
    };
  }

  /**
   * Get all files for a PR including their patch content.
   * Returns empty array if PR has no files.
   */
  async getPrFiles(prId: string): Promise<{ path: string; patch: string | null }[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path, patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    return rows.map((r) => ({ path: r.path, patch: r.patch }));
  }

  /**
   * Get intent data for a PR. Returns null if no intent has been generated.
   */
  async getIntentForPr(prId: string): Promise<{
    intent: string;
    inScope: string[];
    outOfScope: string[];
    riskAreas: string[];
  } | null> {
    const rows = await this.db
      .select({
        intent: t.prIntent.intent,
        inScope: t.prIntent.inScope,
        outOfScope: t.prIntent.outOfScope,
        riskAreas: t.prIntent.riskAreas,
      })
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, prId));
    const row = rows[0];
    if (!row) return null;
    return {
      intent: row.intent,
      inScope: (row.inScope as string[]) ?? [],
      outOfScope: (row.outOfScope as string[]) ?? [],
      riskAreas: (row.riskAreas as string[]) ?? [],
    };
  }

  /**
   * Get the blast radius summary for a PR from the pr_brief table.
   * Returns null if no blast brief exists or blast.summary is not set.
   */
  async getBlastSummaryForPr(prId: string): Promise<string | null> {
    const rows = await this.db
      .select({ json: t.prBrief.json })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId));
    const row = rows[0];
    if (!row) return null;
    const json = row.json as { blast?: { summary?: string } };
    return json?.blast?.summary ?? null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapRow(row: {
  prId: string;
  headSha: string;
  brief: unknown;
  model: string;
  sources: unknown;
  createdAt: Date;
}): RiskBriefRow {
  return {
    prId: row.prId,
    headSha: row.headSha,
    brief: row.brief as Brief,
    model: row.model,
    sources: (row.sources as BriefSources) ?? null,
    generated_at: row.createdAt.toISOString(),
  };
}
