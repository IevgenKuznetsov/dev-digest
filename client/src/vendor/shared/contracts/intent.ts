import { z } from 'zod';

/**
 * Intent Layer contracts — PR intent classification.
 *
 * The IntentClassification is what the flash-class LLM returns (json_schema
 * target). EnrichedIntent is the full persisted record (classification + mechanical
 * metadata added by the server).
 *
 * NOTE: the existing `Intent` contract in brief.ts uses `intent` (text summary).
 * This new contract uses `summary` per the user's spec. The DB column stays
 * `intent` (text); the repository layer maps `summary` ↔ `intent` column.
 */

export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

export const IntentType = z.enum([
  'feature',
  'bug_fix',
  'refactor',
  'chore',
  'security_patch',
  'performance',
  'test',
]);
export type IntentType = z.infer<typeof IntentType>;

/** What the LLM returns (json_schema target for completeStructured). */
export const IntentClassification = z.object({
  summary: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  risk_areas: z.array(z.string()),
  intent_type: IntentType,
});
export type IntentClassification = z.infer<typeof IntentClassification>;

/** Sources metadata (mechanical, not from LLM). */
export const IntentSources = z.object({
  has_body: z.boolean(),
  has_linked_issue: z.boolean(),
  plan_links_found: z.number().int(),
  plan_links_used: z.number().int(),
  plan_links_failed: z.array(z.string()),
  commit_count: z.number().int(),
  file_count: z.number().int(),
  hunk_headers_count: z.number().int(),
});
export type IntentSources = z.infer<typeof IntentSources>;

/** Full persisted record (classification + mechanical metadata). */
export const EnrichedIntent = IntentClassification.extend({
  confidence: IntentConfidence,
  model: z.string().nullish(),
  sources: IntentSources.nullish(),
  created_at: z.string().nullish(),
});
export type EnrichedIntent = z.infer<typeof EnrichedIntent>;
