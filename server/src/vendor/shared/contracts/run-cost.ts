import { z } from 'zod';
import { RunSummary, RunStats } from './trace.js';
import { PrMeta } from './platform.js';

/**
 * Cost-extended contracts for the RunCostBadge feature.
 *
 * These extend the base types from trace.ts / platform.ts with cost fields
 * rather than editing the originals (vendor/shared is extend-only).
 */

/** RunSummary + cost attribution. Returned by GET /pulls/:id/runs. */
export const RunSummaryCost = RunSummary.extend({
  cost_usd: z.number().nullish(),
});
export type RunSummaryCost = z.infer<typeof RunSummaryCost>;

/** RunStats + cost attribution. Embedded in RunTrace.stats for new runs. */
export const RunStatsCost = RunStats.extend({
  cost_usd: z.number().nullable(),
});
export type RunStatsCost = z.infer<typeof RunStatsCost>;

/** PrMeta + latest run cost. Returned by GET /repos/:id/pulls. */
export const PrMetaCost = PrMeta.extend({
  latest_cost_usd: z.number().nullish(),
});
export type PrMetaCost = z.infer<typeof PrMetaCost>;