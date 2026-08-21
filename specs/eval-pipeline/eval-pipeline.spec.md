# Spec: Eval Pipeline

Spec ID: EvalPipeline_1
Status: draft
Supersedes: —

## Problem and User

Agent authors (developers who create and tune review agents in DevDigest) currently have no systematic way to verify that prompt or config changes do not regress the agent's review quality. When an author edits an agent's system prompt, swaps the model, or adds/removes a skill, they must manually re-review sample PRs and eyeball the findings to check for regressions. This is slow, error-prone, and discourages experimentation.

The Eval Pipeline gives agent authors a regression-testing harness: they capture real findings as eval cases (with expected outcomes), run those cases against the agent, and see recall/precision/citation-accuracy metrics over time. This enables confident iteration on agent configuration with quantitative feedback.

## Goals / Non-goals

### Goals
- Allow agent authors to create eval cases directly from accepted/dismissed findings ("Turn into eval case" on FindingCard).
- Store eval cases in Postgres, linked to the owning agent and optionally to the source finding.
- Execute eval cases against the agent (single-case and batch), producing scored results with recall, precision, and citation accuracy metrics.
- Provide an Eval Dashboard page aggregating agent-level stats, trend charts, and recent batch runs.
- Provide a per-agent detail view (clickable from dashboard) with metric trends, run comparison, and a "Promote" action to restore a previous agent version.
- Add an "Evals" tab to the agent editor with case list, run/edit/delete actions, "Run all evals", and "New eval case" entry points.
- Support a "Run on save" toggle that auto-triggers a single-case eval after saving an eval case.

### Non-goals
- **Skill-level evals** — this spec covers agent evals only. Skill evals will be a separate spec.
- **Scheduled/automated eval runs** — batch runs are user-initiated only. Scheduled CI-triggered evals are out of scope.
- **Multi-agent orchestration evals** — evaluating multi-agent review pipelines is not covered.
- **Data retention policies** — unbounded retention for v1. Retention limits are deferred (see Open Questions).
- **Export/import of eval cases** — sharing eval suites across workspaces or agents is not covered.

## User stories

- As an agent author, I want to turn an accepted finding into a "must_find" eval case so that I can verify the agent continues to detect that issue after prompt changes.
- As an agent author, I want to turn a dismissed finding into a "must_not_flag" eval case so that I can verify the agent stops producing false positives after tuning.
- As an agent author, I want to run all eval cases for an agent in one batch so that I can see aggregate regression metrics before promoting a config change.
- As an agent author, I want to see recall, precision, and citation accuracy trends over time so that I can track whether my agent is improving or regressing.
- As an agent author, I want to compare two batch runs side-by-side so that I can understand what changed between agent versions.
- As an agent author, I want to promote a previous agent version when a new version regresses so that I can quickly roll back.
- As an agent author, I want a "Run on save" toggle so that individual cases are automatically validated when I edit them.
- As an agent author, I want to see an overview dashboard of all agents' eval health so that I can prioritize which agents need attention.

## Acceptance criteria (EARS)

### Ubiquitous (always true, no trigger)

- AC-U1: The system shall store eval cases in the `eval_cases` table with columns: `id`, `workspace_id`, `owner_kind`, `owner_id`, `name`, `input_diff`, `input_files`, `input_meta`, `expected_output`, `notes`, `source_finding_id`.
- AC-U2: The system shall store eval runs in the `eval_runs` table with columns: `id`, `case_id`, `batch_id`, `ran_at`, `actual_output`, `pass`, `recall`, `precision`, `citation_accuracy`, `duration_ms`, `cost_usd`, `error`.
- AC-U3: The system shall store eval batches in the `eval_batches` table with columns: `id`, `owner_id`, `owner_kind`, `agent_version`, `ran_at`, `status`, `recall`, `precision`, `citation_accuracy`, `traces_total`, `traces_passed`, `cost_usd`, `duration_ms`.
- AC-U4: The system shall scope all eval queries to the current workspace via `getContext`.
- AC-U5: The system shall represent `expected_output` as a JSONB array of objects, each containing `{ type: 'must_find' | 'must_not_flag', file: string, start_line: number, end_line: number, severity?: string, category?: string, title?: string }`.

### Event-Driven (triggered by an event)

- AC-E1: When the user clicks "Turn into eval case" on a FindingCard, the system shall open the eval case editor modal pre-populated with: name derived from the finding title, `input_diff` captured from the finding's file diff, and `expected_output` set to `must_find` (if finding was accepted) or `must_not_flag` (if finding was dismissed), with file, start_line, end_line, severity, category, and title from the finding.
- AC-E2: When the user clicks "Run all evals" on the agent Evals tab, the system shall create an `eval_batches` row with `status: 'queued'`, then asynchronously execute all eval cases for that agent via p-queue, updating batch status to `'running'` then `'done'` or `'failed'`.
- AC-E3: When a batch execution completes, the system shall compute aggregate metrics: `recall` = (must_find cases found) / (total must_find cases), `precision` = (must_find cases found) / (total findings produced across all cases), `citation_accuracy` = average Jaccard similarity of expected vs actual line ranges across matched must_find cases (0 if no matches).
- AC-E4: When the user clicks "Run case" on a single eval case, the system shall execute that case and create an `eval_runs` row with `batch_id: null`.
- AC-E5: When the user saves an eval case with "Run on save" enabled, the system shall automatically trigger a single-case eval run (standalone, `batch_id: null`).
- AC-E6: When the user clicks "Promote" on a compared run, the system shall create a new agent version (N+1) with the promoted version's config snapshot applied to the agent's current settings.
- AC-E7: When the user selects exactly 2 batch runs and clicks "Compare", the system shall display a comparison view showing: metric deltas (recall/precision/citation_accuracy/pass/cost), system prompt diff, and collapsed "Case changes" section listing pass/fail flips.
- AC-E8: When a batch run completes (status transitions to `'done'` or `'failed'`), the system shall notify users on the Evals tab and Eval Dashboard via polling (4-second interval) and display a toast notification.
- AC-E9: When the user clicks "New eval case" on the agent Evals tab, the system shall open the same eval case editor modal used by "Turn into eval case", but with empty fields.
- AC-E10: When the user deletes an eval case, the system shall cascade-delete all associated `eval_runs` rows.
- AC-E11: When an eval case's `source_finding_id` references a finding that is deleted, the system shall set `source_finding_id` to NULL (ON DELETE SET NULL).

### State-Driven (true while a condition holds)

- AC-S1: While a finding has not been accepted or dismissed, the "Turn into eval case" button shall be disabled on the FindingCard.
- AC-S2: While a batch is in `'queued'` or `'running'` status for an agent, the system shall disable the "Run all evals" button for that agent and display a progress indicator.
- AC-S3: While on the Eval Dashboard page, the system shall poll for batch status updates every 4 seconds.
- AC-S4: While the time-range filter is set (7d, 30d, 90d, or all; default 30d), the trend chart and runs table shall display only batches within the selected range.

### Optional Feature (conditional on feature presence)

- AC-O1: Where the "Run on save" toggle is enabled (default: enabled), the system shall trigger a standalone eval run each time an eval case is saved.
- AC-O2: Where the "Finding skeleton" button is clicked in the eval case editor, the system shall insert a client-side JSON template into the `expected_output` field with placeholder values for type, file, start_line, end_line, severity, category, and title.

### Unwanted Behavior (error/fault handling)

- AC-UB1: If `input_diff` cannot be captured when "Turn into eval case" is clicked (e.g., diff data is no longer available), then the system shall display an error toast and not open the modal.
- AC-UB2: If a single eval case fails during batch execution (LLM error, timeout), then the system shall record `pass: null` and the error message in the `eval_runs.error` column, continue executing remaining cases, and mark the batch as `'done'` if at least one case succeeded.
- AC-UB3: If all eval cases in a batch fail, then the system shall mark the batch status as `'failed'`.
- AC-UB4: If the user submits invalid `expected_output` JSON, then the client shall display inline validation errors and the server shall reject the request with a 400 response and Zod validation details.
- AC-UB5: If a concurrent batch is already running for the same agent, then the system shall reject the new batch request and the UI shall display an informational message.

### Out of scope

- **Skill eval execution** — eval cases with `owner_kind: 'skill'` are stored in the same table schema but execution logic for skills is not covered by this spec. The schema supports it for forward-compatibility; a separate skill-evals spec will define the execution and scoring behavior.
- **Eval case import/export** — bulk import from files or cross-workspace sharing is deferred.
- **Automatic eval scheduling** — there is no cron or webhook trigger for eval runs; all runs are user-initiated (including "Run on save" which is a save-triggered user action).
- **Per-case recall/precision** — recall and precision are batch-level aggregate metrics only. Individual eval runs store `pass` (boolean) and `citation_accuracy` (number or null), not per-case recall/precision.
- **Trend chart for single-case runs** — the trend chart plots one point per batch only. Standalone single-case runs (`batch_id: null`) are excluded from the trend chart.

## Edge cases

| # | Scenario | Expected behavior |
|---|----------|-------------------|
| 1 | Agent has zero eval cases and user clicks "Run all evals" | Display informational message "No eval cases to run". Do not create a batch row. |
| 2 | User deletes an agent that has eval cases and batches | Cascade delete via workspace_id FK removes all associated eval_cases, eval_runs, and eval_batches. |
| 3 | "Turn into eval case" clicked on a finding whose PR diff is from a since-force-pushed commit | Capture the diff eagerly at click time from the client's already-loaded data. If the diff is not available in the client state, show error toast (AC-UB1). |
| 4 | Batch run started, then user navigates away from the page | Batch continues executing server-side. User sees updated status on return via polling. |
| 5 | Two users attempt to start batch runs for the same agent simultaneously | First request creates the batch; second request is rejected with a conflict message (AC-UB5). |
| 6 | Eval case expected_output references a file not present in input_diff | The case runs normally; the agent will not produce a finding for that file, resulting in a `pass: false` for a `must_find` case. No special error handling needed. |
| 7 | Agent version is promoted to a version whose model is no longer available | Promote creates the new version config. The next eval run or review will fail with an LLM adapter error, surfaced as a standard run failure. |
| 8 | Eval case with only `must_not_flag` expectations and agent produces zero findings | All `must_not_flag` cases pass. `citation_accuracy` = null for this case (no must_find to measure). Batch recall = N/A (no must_find cases), precision = 1.0 (no false positives). |
| 9 | Expected_output is an empty array | Case always passes (no expectations to violate). `pass: true`, `citation_accuracy: null`. |
| 10 | "Run on save" is toggled off, user saves eval case | Case is saved without triggering an eval run. |
| 11 | Batch is in 'running' state and server restarts | On boot, stale 'running' batches should be reaped to 'failed' status (following the existing pattern for agent_runs). |

## Non-functional requirements

- **Performance**: Batch eval execution must not block the API event loop. All LLM calls are dispatched via p-queue with configurable concurrency (see Open Questions). Scoring (pass/fail, recall, precision, citation_accuracy) is pure computation with zero LLM calls.
- **Security**: Eval case creation and execution are workspace-scoped. All routes require workspace membership via `getContext`. `input_diff` may contain sensitive code; it is stored in Postgres and never sent to external services beyond the LLM provider (same trust boundary as reviews). No new secrets are introduced.
- **Accessibility**: The Eval Dashboard and agent Evals tab shall be keyboard-navigable. The eval case editor modal shall trap focus and support Escape to close. Pass/fail indicators shall not rely solely on color (use icons or text labels alongside).

## Inputs and provenance

| Input | Source | Format |
|-------|--------|--------|
| Finding data (file, lines, severity, category, title) | `findings` table via FindingCard UI | DB row fields |
| File diff for eval case input | Client-side PR diff data (already loaded) | Unified diff text (string) |
| Agent config (provider, model, system_prompt, skills) | `agents` + `agent_versions` tables | DB row / AgentVersionConfig JSON |
| Expected output assertions | User-authored JSON in eval case editor | JSONB array matching `expected_output` schema |
| LLM response (actual findings) | LLM adapter (OpenAI/Anthropic/OpenRouter) | Parsed findings array |
| Cost metadata | LLM adapter response metadata | `cost_usd` number from adapter |
| Time range filter | User selection in dashboard UI | Enum: '7d', '30d', '90d', 'all' |

## Untrusted inputs

| Input | Risk | Validation |
|-------|------|------------|
| `expected_output` JSON from eval case editor | Malformed JSON, oversized payloads, unexpected keys | Client-side JSON.parse validation + server-side Zod schema validation against `ExpectedOutputItem` array schema. Reject with 400 on failure. |
| `name` field on eval case | XSS if rendered unsanitized, excessively long strings | Server-side: Zod `.min(1).max(255)`. Client-side: React escapes by default. |
| `input_diff` text | Extremely large diffs consuming excessive storage or LLM tokens | Server-side: max length validation (reasonable upper bound, e.g., 500KB). Client captures single-file diff only, limiting size. |
| `notes` field on eval case | XSS, oversized content | Server-side: Zod `.max(5000)`. React default escaping. |
| Route parameters (agent ID, case ID, batch ID) | UUID injection, accessing other workspaces' data | UUID format validation via Zod. Workspace scoping via `getContext` prevents cross-workspace access. |
| Time range query parameter | Unexpected values | Zod enum validation: `'7d' | '30d' | '90d' | 'all'`. Default to `'30d'`. |

## Data model changes

### New table: `eval_batches`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, default random |
| `owner_id` | `uuid` | NOT NULL |
| `owner_kind` | `text ('agent')` | NOT NULL |
| `agent_version` | `integer` | NOT NULL |
| `ran_at` | `timestamptz` | NOT NULL, default now() |
| `status` | `text ('queued' | 'running' | 'done' | 'failed')` | NOT NULL |
| `recall` | `double precision` | nullable |
| `precision` | `double precision` | nullable |
| `citation_accuracy` | `double precision` | nullable |
| `traces_total` | `integer` | nullable |
| `traces_passed` | `integer` | nullable |
| `cost_usd` | `double precision` | nullable |
| `duration_ms` | `integer` | nullable |

### Modified table: `eval_cases`

| Column | Change | Type | Constraints |
|--------|--------|------|-------------|
| `source_finding_id` | ADD | `uuid` | nullable, FK to `findings.id` ON DELETE SET NULL |

### Modified table: `eval_runs`

| Column | Change | Type | Constraints |
|--------|--------|------|-------------|
| `batch_id` | ADD | `uuid` | nullable, FK to `eval_batches.id` ON DELETE CASCADE |
| `error` | ADD | `text` | nullable |

## API routes

| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | `POST` | `/agents/:id/eval-cases` | Create an eval case for an agent |
| 2 | `GET` | `/agents/:id/eval-cases` | List all eval cases for an agent |
| 3 | `GET` | `/eval-cases/:id` | Get a single eval case |
| 4 | `PUT` | `/eval-cases/:id` | Update an eval case |
| 5 | `DELETE` | `/eval-cases/:id` | Delete an eval case (cascades to runs) |
| 6 | `POST` | `/agents/:id/eval-runs` | Start a batch eval run for all agent cases |
| 7 | `POST` | `/eval-cases/:id/run` | Run a single eval case |
| 8 | `GET` | `/agents/:id/eval-batches` | List batches for an agent (with time range filter) |
| 9 | `GET` | `/eval-batches/:id` | Get a single batch with its runs |
| 10 | `GET` | `/eval-dashboard` | Workspace-wide eval dashboard (all agents) |
| 11 | `GET` | `/agents/:id/eval-dashboard` | Per-agent eval dashboard (metrics, trend, recent runs) |
| 12 | `GET` | `/eval-batches/:a/compare/:b` | Compare two batches (metric deltas, prompt diff, case flips) |

## UI specifications

### 1. FindingCard: "Turn into eval case" button

- Location: FindingCard action row, after "Accept", "Dismiss", "Learn" buttons.
- Icon: beaker or test-tube (Lucide).
- Enabled only when finding has `acceptedAt` or `dismissedAt` set.
- Clicking opens the eval case editor modal (shared with "New eval case").

### 2. Eval Dashboard page (`/eval-dashboard`)

- Sidebar: under SKILLS LAB section, after "Conventions", labeled "Eval Dashboard".
- Sidebar key: `eval`.
- Layout per mockup (design2.png):
  - Header: "Eval Dashboard" title + "Run all agents" button (disabled if any agent has a running batch).
  - Agent cards: one per agent, showing version, last run timestamp, case count, mini sparkline, recall/precision/citation_accuracy percentages.
  - Clicking an agent card navigates to the agent detail view.
  - Recent eval runs table below agent cards: agent name, ran_at, version delta, case counts, recall/precision/citation bars, pass fraction, cost.

### 3. Agent detail view (Eval Dashboard > Agent)

- Breadcrumb: Eval Dashboard > {Agent Name}.
- Layout per mockup (design3.png):
  - Header: agent name, version badge, "Run eval" button, agent selector dropdown, time range filter (7d/30d/90d/all, default 30d).
  - Alert banner: shown when latest batch shows a regression (e.g., "Precision dipped 2pts on vN").
  - Three metric cards: Recall, Precision, Citation Accuracy — each with current value, delta from previous batch, and mini sparkline.
  - Metric Trend chart: line chart with one point per batch (x-axis: batch ran_at, y-axis: 0-1). Three lines: recall, precision, citation. Single-case runs excluded.
  - Recent Runs table: ran_at, version, recall bar, precision bar, citation bar, pass fraction, cost. Checkbox column for selecting exactly 2 runs.
  - "Compare" button: enabled when exactly 2 runs are selected.

### 4. Compare view (modal overlay)

- Layout per mockup (design4.png):
  - Header: "Compare runs - v{A} vs v{B}".
  - Metric deltas: recall, precision, citation_accuracy, pass fraction, cost — each showing old value, new value, and delta with color coding (green = improvement, red = regression).
  - System prompt diff: side-by-side or unified diff of the two versions' `system_prompt`.
  - Collapsed "Case changes" section: lists cases whose pass/fail status flipped between the two runs.
  - "Promote v{N}" button: promotes the selected version's config.

### 5. Agent editor "Evals" tab

- Location: agent editor tab bar, after "Stats" tab, labeled "Evals".
- Layout per mockup (design5.png):
  - Eval metrics summary: recall, precision, citation_accuracy, traces passed/total. "View full dashboard" link.
  - Eval cases list: name, expected output summary (e.g., "expected 1 finding, got 1"), severity/category badges, pass/fail indicator, action buttons (run, edit, delete).
  - "Run all evals" button: starts a batch run. Disabled while a batch is in progress.
  - "New eval case" button: opens the eval case editor modal with empty fields.

### 6. Eval case editor modal

- Layout per mockup (design6.png):
  - Title: "Eval case - {name}" (edit) or "New eval case" (create).
  - Fields:
    - Name (text input, required).
    - Input section with three tabs: "Diff" (code editor with unified diff), "Files" (JSON), "PR meta" (JSON).
    - Expected output (JSON editor with syntax highlighting). "Valid JSON" indicator. "Finding skeleton" button inserts template.
  - Footer:
    - "Run on save" toggle (default: enabled).
    - "Last run passed/failed" status with summary (e.g., "expected 1 finding, got 1 - 1.0s - $0.02").
    - "Cancel", "Run case", "Save" buttons.

## Metric definitions

| Metric | Level | Formula |
|--------|-------|---------|
| **pass** (per-case) | eval_run | `true` if ALL expectations in `expected_output` are satisfied: every `must_find` has an overlapping actual finding, every `must_not_flag` has no overlapping actual finding. Overlap = same file AND line ranges intersect. |
| **citation_accuracy** (per-case) | eval_run | For matched `must_find` cases: Jaccard similarity of expected line range vs actual finding line range, averaged across all matched must_find items. `null` if no `must_find` items. |
| **recall** (aggregate) | eval_batch | (number of `must_find` expectations matched by actual findings) / (total `must_find` expectations across all cases in batch). |
| **precision** (aggregate) | eval_batch | (number of actual findings that match a `must_find` expectation) / (total actual findings produced across all cases in batch). |
| **citation_accuracy** (aggregate) | eval_batch | Average of per-case `citation_accuracy` values across all cases that have non-null citation_accuracy. |
| **pass** (aggregate) | eval_batch | `traces_passed` / `traces_total`. |
| **cost** (aggregate) | eval_batch | Sum of per-case `cost_usd` values (from LLM adapter metadata). |

## Execution model

1. **Batch initiation**: `POST /agents/:id/eval-runs` creates an `eval_batches` row (`status: 'queued'`), returns the batch ID immediately (202 Accepted).
2. **Async dispatch**: Server enqueues execution on p-queue. Batch status transitions to `'running'`.
3. **Per-case execution** (Execute phase): For each eval case, invoke the agent's review pipeline with `input_diff` as the diff input. This involves LLM calls via the existing review engine. Cost and duration are captured from adapter metadata.
4. **Per-case scoring** (Score phase): Compare actual findings against `expected_output`. Compute `pass`, `citation_accuracy`. Zero LLM calls in this phase.
5. **Batch aggregation**: After all cases complete (or fail), compute aggregate recall, precision, citation_accuracy, traces_passed, traces_total, cost_usd, duration_ms. Update batch row.
6. **Failure handling**: If a case fails, record `pass: null`, `error: <message>` on the eval_run. Continue with remaining cases. Batch is `'done'` if at least 1 case succeeded, `'failed'` if all cases failed.
7. **Concurrency guard**: Only one batch may run per agent at a time. Concurrent requests are rejected.

## Open questions

- [ ] **Execution concurrency**: What p-queue concurrency level should be used for eval case execution within a batch? Should it match the existing review pipeline concurrency, or have its own configurable limit? (Deferred to implementation.)
- [ ] **Data retention**: Eval runs and batches have unbounded retention in v1. Should a retention policy (e.g., keep last N batches, or TTL-based cleanup) be introduced in a future iteration?
- [ ] **Relationship to existing eval contracts**: The `eval-ci.ts` and `knowledge.ts` contracts already define `EvalCase`, `EvalRun`, `EvalCaseInput`, `EvalRunRecord`, `EvalDashboard`, and `EvalTrendPoint` schemas. The implementation should extend or align with these existing contracts rather than creating conflicting parallel schemas. The exact mapping (which existing schemas to reuse vs. extend) is an implementation decision.
- [ ] **Overlap with existing eval schema**: The `eval_cases` and `eval_runs` tables already exist in `server/src/db/schema/eval.ts`. The new columns (`source_finding_id`, `batch_id`, `error`) and the new `eval_batches` table should be added via migration. The implementation must verify that existing data (if any) is compatible with the schema changes.
- [ ] **Stale batch reaping on boot**: Following the existing pattern for `agent_runs`, stale `'running'` batches should be reaped to `'failed'` on server startup. The implementation should confirm this aligns with the existing reaping mechanism.