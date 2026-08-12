import { z } from 'zod';

/**
 * Blast Radius API contract — raw index data returned by GET /pulls/:id/blast.
 * Distinct from BlastRadius in brief.ts (which is AI-summary-shaped).
 */

export const BlastChangedSymbolApi = z.object({
  file: z.string(),
  name: z.string(),
  kind: z.string(),
});
export type BlastChangedSymbolApi = z.infer<typeof BlastChangedSymbolApi>;

export const BlastCallerApi = z.object({
  file: z.string(),
  symbol: z.string(),
  via_symbol: z.string(),
  line: z.number().int(),
  rank: z.number(),
});
export type BlastCallerApi = z.infer<typeof BlastCallerApi>;

export const BlastRadiusResponse = z.object({
  changed_symbols: z.array(BlastChangedSymbolApi),
  callers: z.array(BlastCallerApi),
  impacted_endpoints: z.array(z.string()),
  facts_by_file: z
    .record(
      z.object({
        endpoints: z.array(z.string()),
        crons: z.array(z.string()),
      }),
    )
    .optional(),
  degraded: z.boolean().optional(),
  reason: z.string().optional(),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;
