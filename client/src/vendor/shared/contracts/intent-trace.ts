import { z } from 'zod';
import { PromptAssembly } from './trace.js';

/**
 * Extended PromptAssembly with intent section.
 *
 * The base PromptAssembly in trace.ts cannot be edited (vendor rule).
 * This file extends it with the pr_intent field added by the Intent Layer.
 * Used by the assemblePrompt() return type and run trace persistence when
 * intent is available.
 */
export const PromptAssemblyWithIntent = PromptAssembly.extend({
  /** Structured intent JSON (untrusted, from the intent classifier); null when absent. */
  pr_intent: z.string().nullish(),
});
export type PromptAssemblyWithIntent = z.infer<typeof PromptAssemblyWithIntent>;
