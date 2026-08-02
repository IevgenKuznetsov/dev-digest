import { z } from 'zod';
import { PrMetaCost } from './run-cost.js';
import { FindingRecord } from './review-api.js';

/**
 * PrMeta extended with per-severity finding counts and a preview array.
 * Returned by GET /repos/:id/pulls so the PR list can render compact
 * severity badges with hover tooltips showing finding details.
 */
export const PrMetaFindings = PrMetaCost.extend({
  critical_count: z.number().int().nullish(),
  warning_count: z.number().int().nullish(),
  suggestion_count: z.number().int().nullish(),
  /** All findings for this PR — used for hover tooltips on the PR list. */
  findings_preview: z.array(FindingRecord).nullish(),
});
export type PrMetaFindings = z.infer<typeof PrMetaFindings>;
