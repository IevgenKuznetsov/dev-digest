import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** Shape returned by getFileFacts — matches RepoIntelRepository.getFileFacts. */
export interface OnboardingFileFact {
  filePath: string;
  endpoints: string[];
  crons: string[];
}

/** Shape returned by getByRepoId. */
export interface OnboardingRow {
  repoId: string;
  json: unknown;
  model: string;
  inputSha: string | null;
  generatedAt: Date;
}

/** Shape returned by getRepoForWorkspace. */
export interface OnboardingRepoRow {
  id: string;
  workspaceId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  clonePath: string | null;
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  /**
   * Get the onboarding row for a repo, or null if none exists.
   */
  async getByRepoId(repoId: string): Promise<OnboardingRow | null> {
    const rows = await this.db
      .select()
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    const row = rows[0];
    if (!row) return null;
    return {
      repoId: row.repoId,
      json: row.json,
      model: row.model,
      inputSha: row.inputSha ?? null,
      generatedAt: row.generatedAt,
    };
  }

  /**
   * Upsert onboarding data for a repo (one row per repo, AC-U1).
   * Returns the upserted row.
   */
  async upsert(
    repoId: string,
    data: { json: object; model: string; inputSha: string | null },
  ): Promise<OnboardingRow> {
    const rows = await this.db
      .insert(t.onboarding)
      .values({
        repoId,
        json: data.json,
        model: data.model,
        inputSha: data.inputSha,
      })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: {
          json: data.json,
          model: data.model,
          inputSha: data.inputSha,
          generatedAt: sql`now()`,
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Upsert returned no rows');
    return {
      repoId: row.repoId,
      json: row.json,
      model: row.model,
      inputSha: row.inputSha ?? null,
      generatedAt: row.generatedAt,
    };
  }

  /**
   * Verify that a repo belongs to a given workspace.
   * Returns the repo row or null if not found / not in workspace.
   */
  async getRepoForWorkspace(
    workspaceId: string,
    repoId: string,
  ): Promise<OnboardingRepoRow | null> {
    const rows = await this.db
      .select({
        id: t.repos.id,
        workspaceId: t.repos.workspaceId,
        owner: t.repos.owner,
        name: t.repos.name,
        defaultBranch: t.repos.defaultBranch,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)));
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      owner: row.owner,
      name: row.name,
      defaultBranch: row.defaultBranch,
      clonePath: row.clonePath ?? null,
    };
  }

  /**
   * Get per-file facts (endpoints/crons) from the file_facts table for the given files.
   * This queries file_facts directly because getFileFacts() is NOT on the RepoIntel facade.
   * Returns [] when files is empty (short-circuit, no query).
   */
  async getFileFacts(repoId: string, files: string[]): Promise<OnboardingFileFact[]> {
    if (files.length === 0) return [];
    const rows = await this.db
      .select({
        filePath: t.fileFacts.filePath,
        endpoints: t.fileFacts.endpoints,
        crons: t.fileFacts.crons,
      })
      .from(t.fileFacts)
      .where(and(eq(t.fileFacts.repoId, repoId), inArray(t.fileFacts.filePath, files)));
    return rows.map((r) => ({
      filePath: r.filePath,
      endpoints: (r.endpoints as string[]) ?? [],
      crons: (r.crons as string[]) ?? [],
    }));
  }
}
