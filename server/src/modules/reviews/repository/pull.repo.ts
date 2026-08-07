import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent, EnrichedIntent } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

export async function upsertIntent(
  db: Db,
  prId: string,
  intent: Intent | EnrichedIntent,
): Promise<void> {
  // Detect EnrichedIntent by checking for `summary` field (new contract)
  const isEnriched = 'summary' in intent;
  const intentText = isEnriched ? (intent as EnrichedIntent).summary : (intent as Intent).intent;
  const enriched = isEnriched ? (intent as EnrichedIntent) : undefined;

  await db
    .insert(t.prIntent)
    .values({
      prId,
      intent: intentText,
      inScope: intent.in_scope,
      outOfScope: intent.out_of_scope,
      ...(enriched
        ? {
            confidence: enriched.confidence ?? 'low',
            riskAreas: enriched.risk_areas ?? [],
            intentType: enriched.intent_type ?? null,
            model: enriched.model ?? null,
            sources: (enriched.sources as Record<string, unknown>) ?? {},
          }
        : {}),
    })
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: {
        intent: intentText,
        inScope: intent.in_scope,
        outOfScope: intent.out_of_scope,
        ...(enriched
          ? {
              confidence: enriched.confidence ?? 'low',
              riskAreas: enriched.risk_areas ?? [],
              intentType: enriched.intent_type ?? null,
              model: enriched.model ?? null,
              sources: (enriched.sources as Record<string, unknown>) ?? {},
            }
          : {}),
      },
    });
}

export async function getIntent(db: Db, prId: string): Promise<EnrichedIntent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    summary: row.intent,
    in_scope: (row.inScope as string[]) ?? [],
    out_of_scope: (row.outOfScope as string[]) ?? [],
    risk_areas: (row.riskAreas as string[]) ?? [],
    intent_type: (row.intentType as EnrichedIntent['intent_type']) ?? 'chore',
    confidence: (row.confidence as EnrichedIntent['confidence']) ?? 'low',
    model: row.model ?? null,
    sources: row.sources as EnrichedIntent['sources'],
    created_at: row.createdAt?.toISOString() ?? null,
  };
}

export async function getPrCommits(
  db: Db,
  prId: string,
): Promise<(typeof t.prCommits.$inferSelect)[]> {
  return db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
}
