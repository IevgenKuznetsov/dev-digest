import { z } from 'zod';
import { OnboardingSection } from './knowledge.js';

/**
 * Onboarding contract — new file (extend-only rule: knowledge.ts is NOT edited).
 *
 * AC-U2: OnboardingSectionKind enum with exactly 5 members.
 * AC-U3: SECTION_ORDER for canonical ordering validation.
 * AC-U6: OnboardingResponse for GET /repos/:id/onboarding.
 * AC-S1: OnboardingGeneratingResponse for in-progress state.
 * AC-U7: GenerateOnboardingBody for POST /repos/:id/onboarding.
 */

// ---- Section kinds ----
export const OnboardingSectionKind = z.enum([
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
]);
export type OnboardingSectionKind = z.infer<typeof OnboardingSectionKind>;

/** Canonical ordering of the 5 sections. */
export const SECTION_ORDER: OnboardingSectionKind[] = [
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
];

/**
 * Strict section schema for LLM output validation.
 * kind is validated as OnboardingSectionKind enum.
 * diagram is intentionally permissive (z.string().nullish()) so the LLM may
 * return any string or null — post-parse normalization in the service layer
 * enforces diagram = null for non-architecture sections AFTER parse succeeds.
 * This avoids burning a parse-failure retry on a recoverable deviation (AC-U4).
 */
export const OnboardingSectionStrict = z.object({
  kind: OnboardingSectionKind,
  title: z.string(),
  body: z.string(),
  diagram: z.string().nullish(),
  links: z.array(
    z.object({
      label: z.string(),
      path: z.string(),
    }),
  ),
});
export type OnboardingSectionStrict = z.infer<typeof OnboardingSectionStrict>;

/** Strict schema for the full LLM response — exactly 5 sections. */
export const StrictOnboardingOutput = z.object({
  sections: z.array(OnboardingSectionStrict).length(5),
});
export type StrictOnboardingOutput = z.infer<typeof StrictOnboardingOutput>;

// ---- API response shapes ----

/**
 * Response for GET /repos/:id/onboarding (200 with tour data).
 * Uses base OnboardingSection from knowledge.ts so the contract is backward-compatible.
 */
export const OnboardingResponse = z.object({
  sections: z.array(OnboardingSection),
  model: z.string(),
  generated_at: z.string(),
  input_sha: z.string().nullable(),
});
export type OnboardingResponse = z.infer<typeof OnboardingResponse>;

/**
 * Response for GET /repos/:id/onboarding when generation is in-progress (AC-S1).
 */
export const OnboardingGeneratingResponse = z.object({
  status: z.literal('generating'),
});
export type OnboardingGeneratingResponse = z.infer<typeof OnboardingGeneratingResponse>;

// ---- POST body ----

/**
 * Body for POST /repos/:id/onboarding.
 * language: ISO 639-1 code (2-5 alpha chars). Defaults to "en" in the route layer.
 * AC-U7, untrusted inputs section: validate as short alpha string.
 */
export const GenerateOnboardingBody = z.object({
  language: z
    .string()
    .regex(/^[a-zA-Z]{2,5}$/, 'language must be a 2-5 character alpha string')
    .optional(),
});
export type GenerateOnboardingBody = z.infer<typeof GenerateOnboardingBody>;
