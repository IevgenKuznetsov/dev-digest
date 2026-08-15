import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ContextDocCategory } from '@devdigest/shared';

export type ContextDocRow = typeof t.contextDocs.$inferSelect;
export type AgentContextDocRow = typeof t.agentContextDocs.$inferSelect;
export type SkillContextDocRow = typeof t.skillContextDocs.$inferSelect;

export interface UpsertDocInput {
  workspaceId: string;
  repoId: string;
  path: string;
  category: ContextDocCategory;
  tokens: number;
  scannedAt: Date;
}

export interface AgentContextDocEntry {
  contextDocId: string;
  order: number;
}

export interface ContextDocWithEntry {
  doc: ContextDocRow;
  order: number;
}

/**
 * Data-access layer for project-context tables.
 * All methods are workspace-aware where needed.
 */
export class ProjectContextRepository {
  constructor(private db: Db) {}

  // ---- context_docs --------------------------------------------------------

  /**
   * Bulk upsert docs by (repoId, path). On conflict updates category, tokens,
   * and scannedAt. Returns the upserted rows.
   */
  async upsertDocs(docs: UpsertDocInput[]): Promise<ContextDocRow[]> {
    if (docs.length === 0) return [];
    return this.db
      .insert(t.contextDocs)
      .values(
        docs.map((d) => ({
          workspaceId: d.workspaceId,
          repoId: d.repoId,
          path: d.path,
          category: d.category,
          tokens: d.tokens,
          scannedAt: d.scannedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [t.contextDocs.repoId, t.contextDocs.path],
        set: {
          category: sql`excluded.category`,
          tokens: sql`excluded.tokens`,
          scannedAt: sql`excluded.scanned_at`,
        },
      })
      .returning();
  }

  /**
   * Delete docs for a repo whose path is NOT in the active set.
   * Used after a scan to remove files that no longer exist on disk (AC-E12).
   */
  async removeStale(repoId: string, activePaths: string[]): Promise<void> {
    if (activePaths.length === 0) {
      // No active files — remove all docs for this repo.
      await this.db.delete(t.contextDocs).where(eq(t.contextDocs.repoId, repoId));
      return;
    }
    await this.db
      .delete(t.contextDocs)
      .where(
        and(
          eq(t.contextDocs.repoId, repoId),
          notInArray(t.contextDocs.path, activePaths),
        ),
      );
  }

  /**
   * List all context docs for a repo, with optional substring search on path.
   * Returns docs ordered by path.
   */
  async listByRepo(repoId: string, search?: string): Promise<ContextDocRow[]> {
    if (search) {
      return this.db
        .select()
        .from(t.contextDocs)
        .where(
          and(
            eq(t.contextDocs.repoId, repoId),
            sql`${t.contextDocs.path} ILIKE ${'%' + search + '%'}`,
          ),
        )
        .orderBy(t.contextDocs.path);
    }
    return this.db
      .select()
      .from(t.contextDocs)
      .where(eq(t.contextDocs.repoId, repoId))
      .orderBy(t.contextDocs.path);
  }

  async getById(docId: string): Promise<ContextDocRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.contextDocs)
      .where(eq(t.contextDocs.id, docId));
    return row;
  }

  async deleteById(docId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.contextDocs)
      .where(eq(t.contextDocs.id, docId))
      .returning({ id: t.contextDocs.id });
    return rows.length > 0;
  }

  async countByRepo(repoId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(t.contextDocs)
      .where(eq(t.contextDocs.repoId, repoId));
    return row?.count ?? 0;
  }

  /** Update tokens for a single doc (called after a content write). */
  async updateTokens(docId: string, tokens: number, scannedAt: Date): Promise<void> {
    await this.db
      .update(t.contextDocs)
      .set({ tokens, scannedAt })
      .where(eq(t.contextDocs.id, docId));
  }

  // ---- agent_context_docs --------------------------------------------------

  /** Docs attached to an agent, joined with context_docs, ordered by .order. */
  async getAgentDocs(agentId: string): Promise<ContextDocWithEntry[]> {
    const rows = await this.db
      .select({ doc: t.contextDocs, order: t.agentContextDocs.order })
      .from(t.agentContextDocs)
      .innerJoin(t.contextDocs, eq(t.agentContextDocs.contextDocId, t.contextDocs.id))
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.order));
    return rows.map((r) => ({ doc: r.doc, order: r.order }));
  }

  /**
   * Replace the full set of attached docs for an agent.
   * Cross-workspace validation: verifies every contextDocId belongs to workspaceId
   * before inserting. Rejects with an error if any ID is from a different workspace.
   */
  async setAgentDocs(
    workspaceId: string,
    agentId: string,
    entries: AgentContextDocEntry[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (entries.length > 0) {
        const ids = entries.map((e) => e.contextDocId);
        const owned = await tx
          .select({ id: t.contextDocs.id })
          .from(t.contextDocs)
          .where(
            and(
              inArray(t.contextDocs.id, ids),
              eq(t.contextDocs.workspaceId, workspaceId),
            ),
          );
        if (owned.length !== ids.length) {
          throw new Error('One or more context doc IDs do not belong to this workspace');
        }
      }

      await tx.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
      if (entries.length === 0) return;

      await tx.insert(t.agentContextDocs).values(
        entries.map((e) => ({
          agentId,
          contextDocId: e.contextDocId,
          order: e.order,
        })),
      );
    });
  }

  // ---- skill_context_docs --------------------------------------------------

  /** Docs attached to a skill, joined with context_docs, ordered by .order. */
  async getSkillDocs(skillId: string): Promise<ContextDocWithEntry[]> {
    const rows = await this.db
      .select({ doc: t.contextDocs, order: t.skillContextDocs.order })
      .from(t.skillContextDocs)
      .innerJoin(t.contextDocs, eq(t.skillContextDocs.contextDocId, t.contextDocs.id))
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(asc(t.skillContextDocs.order));
    return rows.map((r) => ({ doc: r.doc, order: r.order }));
  }

  /**
   * Replace the full set of attached docs for a skill.
   * Same cross-workspace validation as setAgentDocs.
   */
  async setSkillDocs(
    workspaceId: string,
    skillId: string,
    entries: AgentContextDocEntry[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (entries.length > 0) {
        const ids = entries.map((e) => e.contextDocId);
        const owned = await tx
          .select({ id: t.contextDocs.id })
          .from(t.contextDocs)
          .where(
            and(
              inArray(t.contextDocs.id, ids),
              eq(t.contextDocs.workspaceId, workspaceId),
            ),
          );
        if (owned.length !== ids.length) {
          throw new Error('One or more context doc IDs do not belong to this workspace');
        }
      }

      await tx.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
      if (entries.length === 0) return;

      await tx.insert(t.skillContextDocs).values(
        entries.map((e) => ({
          skillId,
          contextDocId: e.contextDocId,
          order: e.order,
        })),
      );
    });
  }

  // ---- Scan guard ----------------------------------------------------------

  /**
   * Check if a context-scan job is currently active (queued or running) for a repo.
   * Used by the 409 concurrent scan guard.
   */
  async isScanRunning(repoId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.jobs.id })
      .from(t.jobs)
      .where(
        and(
          eq(t.jobs.kind, 'context-scan'),
          inArray(t.jobs.status, ['queued', 'running']),
          sql`${t.jobs.payload}->>'repoId' = ${repoId}`,
        ),
      )
      .limit(1);
    return !!row;
  }

  // ---- Context merge queries -----------------------------------------------

  /**
   * Docs for an agent, joined with context_docs, ordered by agent_context_docs.order.
   */
  async getAgentDocsForMerge(agentId: string): Promise<ContextDocRow[]> {
    const rows = await this.db
      .select({ doc: t.contextDocs })
      .from(t.agentContextDocs)
      .innerJoin(t.contextDocs, eq(t.agentContextDocs.contextDocId, t.contextDocs.id))
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.order));
    return rows.map((r) => r.doc);
  }

  /**
   * Enabled skills linked to an agent, ordered by agent_skills.order.
   * Three-way join through agent_skills → skills (to filter enabled=true).
   */
  async getEnabledSkillsForAgent(agentId: string): Promise<Array<typeof t.skills.$inferSelect>> {
    const rows = await this.db
      .select({ skill: t.skills })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(
        and(
          eq(t.agentSkills.agentId, agentId),
          eq(t.skills.enabled, true),
        ),
      )
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => r.skill);
  }

  /**
   * Docs for a skill, joined with context_docs, ordered by skill_context_docs.order.
   */
  async getSkillDocsForMerge(skillId: string): Promise<ContextDocRow[]> {
    const rows = await this.db
      .select({ doc: t.contextDocs })
      .from(t.skillContextDocs)
      .innerJoin(t.contextDocs, eq(t.skillContextDocs.contextDocId, t.contextDocs.id))
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(asc(t.skillContextDocs.order));
    return rows.map((r) => r.doc);
  }
}
