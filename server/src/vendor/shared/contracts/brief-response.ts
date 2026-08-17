import { z } from 'zod';

/**
 * Risk Brief API contract — new file (extend-only rule: brief.ts is NOT edited).
 *
 * AC-U5: BriefRiskLevel enum separate from RiskSeverity in brief.ts.
 * AC-E4: Brief schema passed to completeStructured.
 * EC-10: RiskBriefGeneratingResponse for in-progress state (onboarding pattern).
 */

// ---- Risk level ----

/** Risk level enum for the AI-generated risk brief. Separate from RiskSeverity. */
export const BriefRiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type BriefRiskLevel = z.infer<typeof BriefRiskLevel>;

// ---- Brief sub-schemas ----

export const BriefFileRef = z.object({
  file: z.string(),
  line: z.number().int().optional(),
});
export type BriefFileRef = z.infer<typeof BriefFileRef>;

export const BriefRiskArea = z.object({
  title: z.string(),
  description: z.string().max(1000),
  file_refs: z.array(BriefFileRef),
});
export type BriefRiskArea = z.infer<typeof BriefRiskArea>;

export const BriefReviewFocusItem = z.object({
  file: z.string(),
  line: z.number().int().optional(),
  note: z.string().max(1000),
});
export type BriefReviewFocusItem = z.infer<typeof BriefReviewFocusItem>;

/**
 * The structured output schema passed to completeStructured.
 * REQ-52: String fields are capped to prevent pathological LLM responses from
 * persisting oversized payloads to the DB. Array sizes are capped to match prompt
 * engineering limits (10 risks, 15 review focus items). Zod .max() raises a parse
 * error (not silent truncation), surfaced via the parse-with-repair loop.
 */
export const Brief = z.object({
  what: z.string().max(3000),
  why: z.string().max(3000),
  risk_level: BriefRiskLevel,
  risks: z.array(BriefRiskArea).max(10),
  review_focus: z.array(BriefReviewFocusItem).max(15),
});
export type Brief = z.infer<typeof Brief>;

// ---- Sources metadata ----

export const BriefSources = z.object({
  has_intent: z.boolean(),
  has_blast: z.boolean(),
  has_linked_issue: z.boolean(),
  has_context_docs: z.boolean(),
  context_doc_count: z.number().int(),
});
export type BriefSources = z.infer<typeof BriefSources>;

// ---- API response shapes ----

/**
 * Response for GET /pulls/:id/brief and POST /pulls/:id/brief (200 with brief data).
 */
export const RiskBriefResponse = z.object({
  brief: Brief,
  head_sha: z.string(),
  sources: BriefSources.optional(),
  model: z.string(),
  generated_at: z.string(),
});
export type RiskBriefResponse = z.infer<typeof RiskBriefResponse>;

/**
 * Response for GET /pulls/:id/brief when generation is in-progress (EC-10).
 * Follows the onboarding module's OnboardingGeneratingResponse pattern exactly.
 */
export const RiskBriefGeneratingResponse = z.object({
  status: z.literal('generating'),
});
export type RiskBriefGeneratingResponse = z.infer<typeof RiskBriefGeneratingResponse>;
