import { z } from 'zod';
import { CiInstallation } from './eval-ci.js';

/**
 * ExportToCi_2 — Agent Performance dashboard + extended CI installation view.
 *
 * These EXTEND the barrel; they do not modify `eval-ci.ts` or any other
 * existing contract file (extend-only rule — see root/`server` CLAUDE.md
 * "Do not touch"). `CiInstallation` is reused by composition, not redefined.
 */

// ===========================================================================
// Agent Performance dashboard (GET /ci/performance)
// ===========================================================================

/** Allow-listed dashboard time window, in days. Default is '30' (AC-O3/AC-UN1). */
export const PerfWindow = z.enum(['7', '30', '90']);
export type PerfWindow = z.infer<typeof PerfWindow>;

/**
 * One row of the per-agent performance table.
 *
 * Named `CiAgentPerfRow` (not `AgentPerfRow`) to avoid an export collision
 * with the unrelated, unused `AgentPerfRow` already defined in
 * `productionize.ts` (`GET /agents/performance`, A6) — both files are
 * re-exported from the same barrel via `export *`, so identical names would
 * make the barrel ambiguous (TS2308) and break the build.
 */
export const CiAgentPerfRow = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  avg_cost_usd: z.number().nullable(),
  avg_duration_ms: z.number().nullable(),
  /** `accepted / (accepted + dismissed)` over local review findings; null when none (AC-U3/AC-UN8). */
  accept_rate: z.number().nullable(),
  trend: z.enum(['up', 'down', 'flat']).nullable(),
  last_run_at: z.string().nullable(),
});
export type CiAgentPerfRow = z.infer<typeof CiAgentPerfRow>;

/** One slice of a cost breakdown donut (by agent or by model). */
export const CostSlice = z.object({
  key: z.string(),
  cost_usd: z.number(),
});
export type CostSlice = z.infer<typeof CostSlice>;

/** Response of `GET /ci/performance?window=`. */
export const AgentPerformance = z.object({
  window: PerfWindow,
  total_runs: z.number().int(),
  total_cost_usd: z.number(),
  /** Signed delta vs the immediately preceding equal-length window; null when incomparable. */
  cost_delta_usd: z.number().nullable(),
  avg_accept_rate: z.number().nullable(),
  most_active_agent: z
    .object({
      agent_id: z.string(),
      agent_name: z.string(),
      runs: z.number().int(),
    })
    .nullable(),
  agents: z.array(CiAgentPerfRow),
  cost_by_agent: z.array(CostSlice),
  cost_by_model: z.array(CostSlice),
});
export type AgentPerformance = z.infer<typeof AgentPerformance>;

// ===========================================================================
// Extended CI installation view (GET /ci/installations)
// ===========================================================================

/**
 * `CiInstallation` extended with the agent's manifest version and the latest
 * joined `ci_runs` status/time — derived by read-time join, no new columns
 * (AC-U5). Reuses `CiInstallation` from `eval-ci.ts` by composition.
 */
export const CiInstallationView = CiInstallation.extend({
  agent_version: z.number().nullable(),
  last_status: z.string().nullable(),
  last_run_at: z.string().nullable(),
});
export type CiInstallationView = z.infer<typeof CiInstallationView>;
