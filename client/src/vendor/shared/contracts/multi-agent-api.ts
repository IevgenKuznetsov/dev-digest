import { z } from 'zod';
import { AgentColumn, MultiAgentRun } from './observability.js';
import { ReviewRunTarget } from './review-api.js';

/**
 * Multi-Agent Review API contracts.
 *
 * New contracts for the multi-agent review feature. This file extends the
 * existing observability.ts contracts without modifying them.
 *
 * Endpoints covered:
 *   POST /pulls/:prId/multi-agent-run  → MultiAgentRunRequest / MultiAgentRunResponse
 *   GET  /multi-agent-run/:id          → MultiAgentRunDetail
 *   GET  /agents/estimates             → MultiAgentEstimate
 */

// ---------------------------------------------------------------------------
// POST /pulls/:prId/multi-agent-run — request body
// ---------------------------------------------------------------------------

export const MultiAgentRunRequest = z.object({
  /** UUIDs of agents to include in this run. At least one required. */
  agent_ids: z.array(z.string().uuid()).min(1, 'At least one agent must be selected.'),
});
export type MultiAgentRunRequest = z.infer<typeof MultiAgentRunRequest>;

// ---------------------------------------------------------------------------
// POST response — returned immediately after agent_runs rows are created
// ---------------------------------------------------------------------------

export const MultiAgentRunResponse = z.object({
  /** The newly created multi_agent_runs.id. */
  id: z.string(),
  /** Per-agent run stubs — enough for the client to subscribe to SSE streams. */
  runs: z.array(ReviewRunTarget),
});
export type MultiAgentRunResponse = z.infer<typeof MultiAgentRunResponse>;

// ---------------------------------------------------------------------------
// GET /agents/estimates — pre-run cost/duration estimate
// ---------------------------------------------------------------------------

/** Historical cost/duration data for one agent, derived from its most recent
 *  completed agent_run in the workspace. Null fields mean no historical data. */
export const AgentEstimate = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  /** Most recent completed run cost; null when no completed runs exist. */
  cost_usd: z.number().nullable(),
  /** Most recent completed run duration; null when no completed runs exist. */
  duration_ms: z.number().nullable(),
});
export type AgentEstimate = z.infer<typeof AgentEstimate>;

/** Aggregate pre-run estimate for a set of selected agents.
 *  total_cost_usd = sum of agent costs (null when ALL agents lack data).
 *  total_duration_ms = max of agent durations (null when ALL agents lack data).
 *  is_partial = true when at least one selected agent has no historical data. */
export const MultiAgentEstimate = z.object({
  agents: z.array(AgentEstimate),
  /** Sum of each agent's most recent cost_usd; null if no data exists. */
  total_cost_usd: z.number().nullable(),
  /** Max of each agent's most recent duration_ms; null if no data exists. */
  total_duration_ms: z.number().nullable(),
  /** True when at least one agent has no historical run data. */
  is_partial: z.boolean(),
});
export type MultiAgentEstimate = z.infer<typeof MultiAgentEstimate>;

// ---------------------------------------------------------------------------
// GET /multi-agent-run/:id — full results including token data in columns
// ---------------------------------------------------------------------------

/**
 * Extends AgentColumn with token counts that exist on agent_runs but are absent
 * from the uneditable AgentColumn contract in observability.ts.
 */
export const MultiAgentAgentColumn = AgentColumn.extend({
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
});
export type MultiAgentAgentColumn = z.infer<typeof MultiAgentAgentColumn>;

/**
 * Full multi-agent run detail returned by GET /multi-agent-run/:id.
 * Overrides the base `columns` field to include token data per column.
 */
export const MultiAgentRunDetail = MultiAgentRun.extend({
  columns: z.array(MultiAgentAgentColumn),
});
export type MultiAgentRunDetail = z.infer<typeof MultiAgentRunDetail>;
