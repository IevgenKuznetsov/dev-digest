import { z } from 'zod';
import { Severity } from './findings.js';
import { EvalOwnerKind, EvalCase } from './knowledge.js';
import { EvalRunRecord } from './eval-ci.js';

/**
 * Eval Pipeline contracts — new schemas for the regression-testing harness.
 *
 * Reuses existing types from knowledge.ts (EvalOwnerKind, EvalCase) and
 * eval-ci.ts (EvalRunRecord, EvalDashboard, EvalTrendPoint) by importing them —
 * no duplication. Extends with batch tracking, comparison, and dashboard types.
 *
 * Do NOT modify existing contract files — only add here (CLAUDE.md rule).
 * Do NOT re-export symbols already exported by knowledge.ts / eval-ci.ts —
 * those are already in the barrel; duplicating them causes TS "duplicate export" errors.
 */

// ===========================================================================
// ExpectedOutputItem — the typed schema for expected_output JSONB array items
// ===========================================================================

/** One assertion in an eval case's `expected_output` array (AC-U5). */
export const ExpectedOutputItem = z.object({
  type: z.enum(['must_find', 'must_not_flag']),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: Severity.optional(),
  category: z.string().optional(),
  title: z.string().optional(),
});
export type ExpectedOutputItem = z.infer<typeof ExpectedOutputItem>;

// ===========================================================================
// Eval Batch
// ===========================================================================

export const EvalBatchStatus = z.enum(['queued', 'running', 'done', 'failed']);
export type EvalBatchStatus = z.infer<typeof EvalBatchStatus>;

/** A persisted eval_batches row returned by the API. */
export const EvalBatchRecord = z.object({
  id: z.string(),
  owner_id: z.string(),
  owner_kind: z.string(),
  agent_version: z.number().int(),
  ran_at: z.string(),
  status: EvalBatchStatus,
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  traces_total: z.number().int().nullable(),
  traces_passed: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
});
export type EvalBatchRecord = z.infer<typeof EvalBatchRecord>;

/** EvalBatchRecord with associated runs. */
export const EvalBatchWithRuns = EvalBatchRecord.extend({
  runs: z.array(EvalRunRecord),
});
export type EvalBatchWithRuns = z.infer<typeof EvalBatchWithRuns>;

// ===========================================================================
// Eval Run (extended with batch_id + error)
// ===========================================================================

/**
 * EvalRunRecord extended with batch_id and error fields (new columns from
 * the eval pipeline migration).
 */
export const EvalBatchRunRecord = EvalRunRecord.extend({
  batch_id: z.string().nullable(),
  error: z.string().nullable(),
});
export type EvalBatchRunRecord = z.infer<typeof EvalBatchRunRecord>;

// ===========================================================================
// Eval Case (extended with source_finding_id)
// ===========================================================================

/**
 * EvalCase extended with source_finding_id (new column from the eval pipeline
 * migration). Defined as a standalone schema (not modifying knowledge.ts).
 */
export const EvalCaseRecord = EvalCase.extend({
  workspace_id: z.string(),
  source_finding_id: z.string().nullable(),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseRecord>;

// ===========================================================================
// Time Range Filter
// ===========================================================================

export const TimeRangeFilter = z.enum(['7d', '30d', '90d', 'all']).default('30d');
export type TimeRangeFilter = z.infer<typeof TimeRangeFilter>;

// ===========================================================================
// Create / Update Eval Case Input
// ===========================================================================

/** Request body for POST /agents/:id/eval-cases. */
export const CreateEvalCaseInput = z.object({
  name: z.string().min(1).max(255),
  /** Unified diff text; max ~500KB for ASCII-dominant diffs. */
  input_diff: z.string().max(512_000).default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.array(ExpectedOutputItem),
  notes: z.string().max(5000).optional(),
  source_finding_id: z.string().uuid().optional(),
});
export type CreateEvalCaseInput = z.infer<typeof CreateEvalCaseInput>;

/** Request body for PUT /eval-cases/:id — all fields optional. */
export const UpdateEvalCaseInput = CreateEvalCaseInput.partial();
export type UpdateEvalCaseInput = z.infer<typeof UpdateEvalCaseInput>;

// ===========================================================================
// Eval Batch Comparison
// ===========================================================================

/** Per-metric delta between two batches. */
export const MetricDelta = z.object({
  a: z.number().nullable(),
  b: z.number().nullable(),
  delta: z.number().nullable(),
});
export type MetricDelta = z.infer<typeof MetricDelta>;

/** Case whose pass/fail status flipped between two batches. */
export const CaseFlip = z.object({
  case_id: z.string(),
  case_name: z.string().nullish(),
  /** true = was passing in A, now failing in B. false = was failing, now passing. */
  regression: z.boolean(),
  pass_a: z.boolean().nullable(),
  pass_b: z.boolean().nullable(),
});
export type CaseFlip = z.infer<typeof CaseFlip>;

/** Response for GET /eval-batches/:a/compare/:b. */
export const EvalBatchComparison = z.object({
  batch_a: EvalBatchRecord,
  batch_b: EvalBatchRecord,
  recall: MetricDelta,
  precision: MetricDelta,
  citation_accuracy: MetricDelta,
  pass_fraction: MetricDelta,
  cost_usd: MetricDelta,
  system_prompt_a: z.string().nullish(),
  system_prompt_b: z.string().nullish(),
  case_flips: z.array(CaseFlip),
});
export type EvalBatchComparison = z.infer<typeof EvalBatchComparison>;

// ===========================================================================
// Eval Agent Summary — per-agent card for workspace dashboard
// ===========================================================================

/** Per-agent summary card for the workspace-wide eval dashboard. */
export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  agent_version: z.number().int(),
  last_ran_at: z.string().nullable(),
  cases_total: z.number().int(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  traces_passed: z.number().int().nullable(),
  traces_total: z.number().int().nullable(),
  /** Latest batch status (null if no batches yet). */
  latest_status: EvalBatchStatus.nullable(),
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;

/** Response for GET /eval-dashboard — workspace-wide. */
export const EvalWorkspaceDashboard = z.object({
  agents: z.array(EvalAgentSummary),
  recent_batches: z.array(
    EvalBatchRecord.extend({
      agent_name: z.string().nullish(),
    }),
  ),
});
export type EvalWorkspaceDashboard = z.infer<typeof EvalWorkspaceDashboard>;
