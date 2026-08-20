# Implementation Plan: Eval Pipeline

**Spec:** `specs/eval-pipeline/eval-pipeline.spec.md`
**Scope:** server, client (cross-package)
**Estimated complexity:** high
**Multi-agent execution:** yes (user approved) -- server and client agents work in parallel after Step 1 (shared contracts)
**Created:** 2026-08-20

## Context

Agent authors currently have no systematic way to verify that prompt or config changes do not regress review quality. The Eval Pipeline provides a regression-testing harness: capture real findings as eval cases (with expected outcomes), run those cases against the agent, and see recall/precision/citation-accuracy metrics over time. This is a cross-package feature spanning new server-side evaluation logic and new client-side dashboard/editor UI.

## Requirements Summary

The spec defines 5 ubiquitous criteria (data model), 11 event-driven criteria (user actions triggering eval workflows), 4 state-driven criteria (UI state management), 2 optional-feature criteria (run-on-save, finding skeleton), and 5 unwanted-behavior criteria (error handling). All criteria are addressed by the steps below.

## Spec Coverage Matrix

| Criterion | EARS Pattern | Plan Step(s) | Status |
|-----------|-------------|--------------|--------|
| AC-U1: eval_cases table schema | Ubiquitous | Step 2, Step 3 | COVERED |
| AC-U2: eval_runs table schema | Ubiquitous | Step 2, Step 3 | COVERED |
| AC-U3: eval_batches table schema | Ubiquitous | Step 2, Step 3 | COVERED |
| AC-U4: workspace scoping via getContext | Ubiquitous | Step 4, Step 5 | COVERED |
| AC-U5: expected_output JSONB schema | Ubiquitous | Step 1 | COVERED |
| AC-E1: Turn into eval case from FindingCard | Event-Driven | Step 7 | COVERED |
| AC-E2: Run all evals batch creation | Event-Driven | Step 4, Step 5 | COVERED |
| AC-E3: Batch aggregate metrics | Event-Driven | Step 4 | COVERED |
| AC-E4: Run single eval case | Event-Driven | Step 4, Step 5 | COVERED |
| AC-E5: Run on save auto-trigger | Event-Driven | Step 10 | COVERED |
| AC-E6: Promote agent version | Event-Driven | Step 5, Step 9 | COVERED |
| AC-E7: Compare two batch runs | Event-Driven | Step 5, Step 9 | COVERED |
| AC-E8: Polling + toast on batch completion | Event-Driven | Step 6, Step 8, Step 9 | COVERED |
| AC-E9: New eval case from Evals tab | Event-Driven | Step 10 | COVERED |
| AC-E10: Cascade delete eval case -> runs | Event-Driven | Step 2, Step 3 | COVERED |
| AC-E11: ON DELETE SET NULL for source_finding_id | Event-Driven | Step 2, Step 3 | COVERED |
| AC-S1: Disabled button when finding not accepted/dismissed | State-Driven | Step 7 | COVERED |
| AC-S2: Disabled Run all evals while batch running | State-Driven | Step 6, Step 10 | COVERED |
| AC-S3: Dashboard polls every 4s | State-Driven | Step 8 | COVERED |
| AC-S4: Time-range filter on dashboard | State-Driven | Step 5, Step 8, Step 9 | COVERED |
| AC-O1: Run on save toggle | Optional | Step 6, Step 10 | COVERED |
| AC-O2: Finding skeleton template button | Optional | Step 10 | COVERED |
| AC-UB1: Missing diff error toast | Unwanted | Step 7 | COVERED |
| AC-UB2: Per-case failure handling (batch continues) | Unwanted | Step 4 | COVERED |
| AC-UB3: All cases fail -> batch 'failed' | Unwanted | Step 4 | COVERED |
| AC-UB4: Invalid expected_output validation | Unwanted | Step 1, Step 5, Step 10 | COVERED |
| AC-UB5: Concurrent batch rejection | Unwanted | Step 4, Step 5 | COVERED |

## Recommendations Applied

1. **Own PQueue for eval batches** -- use a standalone `PQueue` instance inside the evals service (concurrency 2) rather than the shared `JobRunner`. This isolates eval LLM calls from review/indexing work and avoids the `jobs` table overhead (evals have their own `eval_batches` status tracking). User approved.

2. **Reuse `reviewPullRequest()` directly** -- construct a minimal `UnifiedDiff` from the eval case's `input_diff` text string and call the reviewer-core engine directly. This avoids the `ReviewRunExecutor` orchestration (which loads diffs from git, manages SSE, persists agent_runs). User approved.

3. **Reuse `AgentsService.update()` for promote** -- promoting a version means reading the old version's `AgentVersionConfig` and passing it as an update to the current agent, which triggers the existing version bump + snapshot logic. User approved.

4. **Sidebar nav via local extension** -- follow the `LOCAL_SECTIONS` pattern from INSIGHTS.md. Do NOT edit `vendor/ui/nav.ts`. User approved.

## Architecture Constraints

- `vendor/shared/` -- extend with new files only, never edit existing contracts. New file: `eval-pipeline.ts`. Source: root `CLAUDE.md`, server `CLAUDE.md`.
- Modules registered statically in `server/src/modules/index.ts`. Source: root `CLAUDE.md`.
- Migrations are NOT applied on boot -- plan includes migration generation + manual `pnpm db:migrate`. Source: root `CLAUDE.md`.
- Secrets in `~/.devdigest/secrets.json`, never env/git/DB. Source: root `CLAUDE.md`. (No new secrets for this feature.)
- reviewer-core consumed as raw TypeScript source. Source: root `CLAUDE.md`.
- `INJECTION_GUARD` in `reviewer-core/src/prompt.ts` -- never touch. Source: root `CLAUDE.md`.
- Grounding gate in `reviewer-core/src/grounding.ts` -- never touch. Source: root `CLAUDE.md`.
- Routes delegate to Service, Service to Repository (onion pattern). Source: server `INSIGHTS.md`.
- Client `vendor/shared/` is a physical copy, not a symlink -- new contract file must be copied AND barrel-exported in both server and client. Source: client `INSIGHTS.md`.

## Pre-implementation Checklist

- [x] Migration needed? Yes -- new `eval_batches` table, new columns on `eval_cases` (`source_finding_id`) and `eval_runs` (`batch_id`, `error`).
- [x] New module needed? Yes -- `server/src/modules/evals/`. Register in `modules/index.ts`.
- [x] New shared contracts needed? Yes -- `vendor/shared/contracts/eval-pipeline.ts` (new file).
- [x] New adapter needed? No -- uses existing `LLMProvider` via `container.llm()`.

## Steps

### Step 1: Shared Contracts -- `eval-pipeline.ts`

**Package:** server (then copy to client)
**Files:**
- `server/src/vendor/shared/contracts/eval-pipeline.ts` (create)
- `server/src/vendor/shared/index.ts` (modify -- add barrel export)
- `client/src/vendor/shared/contracts/eval-pipeline.ts` (create -- copy)
- `client/src/vendor/shared/index.ts` (modify -- add barrel export)
**What:** Define Zod schemas for eval pipeline API contracts. This is the foundation both server and client depend on, so it must be completed first.

Schemas to define:
- `ExpectedOutputItem` -- `z.object({ type: z.enum(['must_find', 'must_not_flag']), file: z.string(), start_line: z.number().int(), end_line: z.number().int(), severity: Severity.optional(), category: z.string().optional(), title: z.string().optional() })`. This is the typed schema for the JSONB `expected_output` array items (AC-U5).
- `EvalBatchStatus` -- `z.enum(['queued', 'running', 'done', 'failed'])`.
- `EvalBatchRecord` -- mirrors the `eval_batches` row for API responses: `id`, `owner_id`, `owner_kind`, `agent_version`, `ran_at`, `status`, `recall`, `precision`, `citation_accuracy`, `traces_total`, `traces_passed`, `cost_usd`, `duration_ms`.
- `CreateEvalCaseInput` -- request body for `POST /agents/:id/eval-cases`: `name` (min 1, max 255), `input_diff` (`.max(512_000)` character limit — approximates 500KB for ASCII-dominant diffs; exact byte enforcement deferred), `input_files` (optional), `input_meta` (optional), `expected_output` (array of `ExpectedOutputItem`), `notes` (optional, max 5000), `source_finding_id` (optional uuid).
- `UpdateEvalCaseInput` -- partial version of create (all fields optional except at least one required).
- `EvalCaseRecord` -- extends the existing `EvalCase` from `knowledge.ts` with `source_finding_id: z.string().nullable()`. Defined as a new standalone schema (not modifying `knowledge.ts`).
- `EvalBatchRunRecord` -- extends `EvalRunRecord` from `eval-ci.ts` with `batch_id: z.string().nullable()` and `error: z.string().nullable()`.
- `TimeRangeFilter` -- `z.enum(['7d', '30d', '90d', 'all']).default('30d')`.
- `EvalBatchComparison` -- response for the compare endpoint: metric deltas, system prompt diff, case flips.
- `EvalAgentSummary` -- per-agent card data for the workspace dashboard.

Reuse existing types from `knowledge.ts` (`EvalOwnerKind`, `EvalCase`, `EvalRun`) and from `eval-ci.ts` (`EvalRunRecord`, `EvalDashboard`, `EvalTrendPoint`) by importing them -- do NOT duplicate.

**Skills:** `zod`, `typescript-expert`
**Tests:** No tests for pure schema definitions (tested transitively via service/route tests).
**Depends on:** none
**Addresses:** AC-U5, AC-UB4 (schema validation foundation)

---

### Step 2: DB Schema Changes -- Drizzle Definitions

**Package:** server
**Files:**
- `server/src/db/schema/eval.ts` (modify)
- `server/src/db/schema.ts` (modify -- add `evalBatches` to barrel + schema object)
**What:** Add the `eval_batches` table definition and new columns to existing `eval_cases` and `eval_runs` tables.

**Pre-check:** Before modifying, verify existing `eval_cases` and `eval_runs` columns match AC-U1/AC-U2 from the spec. If any column is missing or mistyped, add/fix it in the same migration.

Changes to `eval.ts`:
1. Import `findings` from `./reviews` and `agents` from `./agents` for FK references.
2. Add `evalBatches` table: `id` (uuid PK), `ownerId` (uuid, NOT NULL, **FK to `agents.id` ON DELETE CASCADE**), `ownerKind` (text enum ['agent'], NOT NULL), `agentVersion` (integer, NOT NULL), `ranAt` (timestamptz, default now, NOT NULL), `status` (text enum ['queued', 'running', 'done', 'failed'], NOT NULL), `recall` (doublePrecision, nullable), `precision` (doublePrecision, nullable), `citationAccuracy` (doublePrecision, nullable), `tracesTotal` (integer, nullable), `tracesPassed` (integer, nullable), `costUsd` (doublePrecision, nullable), `durationMs` (integer, nullable).
3. Add to `evalCases`: `sourceFindingId` (uuid, nullable, FK to `findings.id` ON DELETE SET NULL).
4. Add to `evalRuns`: `batchId` (uuid, nullable, FK to `evalBatches.id` ON DELETE CASCADE), `error` (text, nullable). **Also verify** that `evalRuns` has `recall` (doublePrecision, nullable) and `precision` (doublePrecision, nullable) columns per AC-U2. If missing, add them in this migration. These columns exist for spec completeness; they are populated as `null` for per-case runs in v1 (recall/precision are computed at batch level only).
5. Add `evalBatches` to the barrel export in `schema.ts` and the `schema` object.

**Cascade chain:** Deleting an agent cascades to `eval_batches` (via `ownerId` FK), which cascades to `eval_runs` (via `batchId` FK). Agent deletion also cascades to `eval_cases` (via existing `ownerId` FK), which cascades to `eval_runs` (via `caseId` FK). This satisfies spec EDGE-2.

**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`
**Tests:** Schema changes verified transitively by migration generation + integration tests.
**Depends on:** none (parallel with Step 1)
**Addresses:** AC-U1, AC-U2, AC-U3, AC-E10, AC-E11

---

### Step 3: DB Migration

**Package:** server
**Files:**
- `server/src/db/migrations/0017_eval_pipeline.sql` (create -- generated by `pnpm db:generate`)
**What:** Generate and verify the migration SQL for the schema changes in Step 2.

Run `cd server && pnpm db:generate` to produce the migration file. The generated SQL should contain:
1. `CREATE TABLE eval_batches (...)` with all columns from Step 2.
2. `ALTER TABLE eval_cases ADD COLUMN source_finding_id UUID REFERENCES findings(id) ON DELETE SET NULL`.
3. `ALTER TABLE eval_runs ADD COLUMN batch_id UUID REFERENCES eval_batches(id) ON DELETE CASCADE`.
4. `ALTER TABLE eval_runs ADD COLUMN error TEXT`.
5. Indexes: `CREATE INDEX ON eval_batches (owner_id)` and `CREATE INDEX ON eval_runs (batch_id)`.
6. Concurrency guard index: `CREATE UNIQUE INDEX eval_batches_active_per_owner ON eval_batches (owner_id) WHERE status IN ('queued', 'running')`. This enforces at most one active batch per agent at the DB level (authoritative guard — the in-memory lock is a fast-path only).

After generation, verify the migration is correct and then run `pnpm db:migrate` to apply it.

**Note:** Existing data compatibility -- `eval_cases` and `eval_runs` tables may already have rows. All new columns are nullable, so existing rows remain valid.

**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`
**Tests:** Migration applied successfully; integration tests will validate.
**Depends on:** Step 2
**Addresses:** AC-U1, AC-U2, AC-U3, AC-E10, AC-E11

---

### Step 4: Server Module -- Repository, Service, Scoring Logic

**Package:** server
**Files:**
- `server/src/modules/evals/repository.ts` (create)
- `server/src/modules/evals/service.ts` (create)
- `server/src/modules/evals/scoring.ts` (create)
- `server/src/modules/evals/helpers.ts` (create)
- `server/src/modules/evals/constants.ts` (create)
**What:** Core server-side eval pipeline logic: data access, eval execution, and metric scoring.

**Repository** (`repository.ts`):
- `EvalRepository` class, constructor takes `Db`.
- CRUD for eval cases: `createCase`, `getCase`, `listCasesForOwner`, `updateCase`, `deleteCase`. All scoped by `workspaceId` (joined via `evalCases.workspaceId`).
- CRUD for eval batches: `createBatch`, `getBatch`, `updateBatch`, `listBatchesForOwner` (with time-range filter), `getActiveBatchForOwner` (status = 'queued' OR 'running'), `reapStaleBatches` (set 'running' -> 'failed').
- Eval runs: `createRun`, `listRunsForBatch`, `listRunsForCase`.
- Compare: `getRunsForBatches(batchIdA, batchIdB)` -- returns runs for two batches.
- Dashboard: `getDashboardForOwner(ownerId)` -- aggregate stats, `getWorkspaceDashboard(workspaceId)` -- all agents.
- **Workspace scoping for `eval_batches`:** Since `eval_batches` has no `workspace_id` column, workspace-scope queries via `JOIN agents ON eval_batches.owner_id = agents.id WHERE agents.workspace_id = ?`.

**Scoring** (`scoring.ts`):
- Pure functions, zero LLM calls (AC-E3 scoring):
  - `computePass(expected: ExpectedOutputItem[], actualFindings: Finding[]): boolean` -- checks ALL expectations. `must_find` requires an overlapping actual finding (same file, intersecting line ranges). `must_not_flag` requires NO overlapping actual finding.
  - `computeCitationAccuracy(expected: ExpectedOutputItem[], actualFindings: Finding[]): number | null` -- Jaccard similarity of line ranges for matched must_find items, averaged. Returns null if no must_find items.
  - `computeBatchMetrics(runs: { expected: ExpectedOutputItem[]; actual: Finding[]; pass: boolean | null }[]): { recall, precision, citation_accuracy, traces_passed, traces_total }` -- aggregate metrics per spec formula. **Division-by-zero guards:** if `totalMustFind === 0`, set `recall = null` (spec says "N/A"). If `totalFindings === 0` AND all expectations are `must_not_flag`, set `precision = 1.0` (no false positives — spec EDGE-8). If `totalFindings === 0` with `must_find` expectations present, set `precision = null`. Empty `expected_output` array → `pass: true`, `citation_accuracy: null`.
  - `lineRangeOverlaps(a: {start: number, end: number}, b: {start: number, end: number}): boolean`
  - `jaccardLineRange(a: {start: number, end: number}, b: {start: number, end: number}): number`

**Service** (`service.ts`):
- `EvalsService` class, constructor takes `Container`.
- In-memory lock: `Map<string, Promise<void>>` keyed by `ownerId` -- prevents concurrent batches (AC-UB5). Follows the onboarding module pattern.
- Own `PQueue` instance (concurrency 2) for eval case execution within a batch.
- `createCase(workspaceId, agentId, input)` -- validate `expected_output` with `ExpectedOutputItem` array schema, insert row.
- `getCase(workspaceId, caseId)` -- with workspace ownership check.
- `updateCase(workspaceId, caseId, input)` -- validate, update row.
- `deleteCase(workspaceId, caseId)` -- cascade to runs via FK.
- `listCases(workspaceId, agentId)`.
- `runSingleCase(workspaceId, caseId)` -- execute one eval case. Build a minimal `UnifiedDiff` from `input_diff` (parse the unified diff text into the `UnifiedDiff` shape). Load the agent config, resolve skills, call `reviewPullRequest()` from reviewer-core. Score the result. Insert `eval_runs` row with `batch_id: null`. Return result.
- `startBatch(workspaceId, agentId)` -- check no active batch (in-memory lock + DB check). If zero cases, return error. Create `eval_batches` row (status: 'queued'). Return batch ID immediately. Fire-and-forget: transition to 'running', iterate cases on PQueue, score each, aggregate, update batch to 'done' or 'failed'. Error handling per AC-UB2/UB3.
- `getBatch(workspaceId, batchId)` -- with runs.
- `listBatches(workspaceId, agentId, timeRange)` -- filtered by time range.
- `compareBatches(workspaceId, batchIdA, batchIdB)` -- load both batches + their runs, load agent version configs for system prompt diff, compute metric deltas, identify pass/fail flips.
- `promoteVersion(workspaceId, agentId, version)` -- load the target version's `AgentVersionConfig`, call `AgentsService.update()` with those fields to create a new version (N+1). Reuse existing logic.
- `getDashboard(workspaceId, agentId?, timeRange?)` -- aggregate data.
- `reapStaleBatches()` -- called on boot. Set 'running' or 'queued' batches to 'failed'.

**Helpers** (`helpers.ts`):
- `parseDiffToUnifiedDiff(diffText: string): UnifiedDiff` -- parse a unified diff text string into the `UnifiedDiff` shape expected by `reviewPullRequest()`. Extract file paths, hunks, line numbers, additions/deletions. Use basic unified diff parsing (split on `diff --git` / `---` / `+++` / `@@` headers).
- DTO mappers: `toEvalCaseDto`, `toEvalBatchDto`, `toEvalRunDto`.

**Constants** (`constants.ts`):
- `EVAL_BATCH_CONCURRENCY = 2`
- `EVAL_MAX_DIFF_BYTES = 512_000` (500KB)
- `EVAL_CASE_NAME_MAX = 255`
- `EVAL_NOTES_MAX = 5000`

**Skills:** `fastify-best-practices`, `drizzle-orm-patterns`, `typescript-expert`, `security`
**Tests:**
- `server/src/modules/evals/scoring.test.ts` (unit) -- test all scoring functions with various expected/actual combinations including edge cases: empty `expected_output` array (→ `pass: true`, `citation_accuracy: null`), must_not_flag only with zero findings (→ all pass, `recall: null`, `precision: null`), no matches, partial overlaps, division-by-zero guards for recall/precision.
- `server/src/modules/evals/helpers.test.ts` (unit) -- test `parseDiffToUnifiedDiff` with sample diffs.
- `server/src/modules/evals/service.test.ts` (unit) -- test service logic with mocked repository and container (concurrency guard, batch lifecycle, promote).
**Depends on:** Step 1, Step 2, Step 3
**Addresses:** AC-U4, AC-E2, AC-E3, AC-E4, AC-E6, AC-UB2, AC-UB3, AC-UB5

---

### Step 5: Server Module -- Routes + Module Registration

**Package:** server
**Files:**
- `server/src/modules/evals/routes.ts` (create)
- `server/src/modules/index.ts` (modify -- add `evals` entry)
- `server/src/app.ts` (modify -- add stale batch reaping on boot)
**What:** Fastify routes for the eval pipeline API, module registration, and boot-time stale batch reaping.

**Routes** (`routes.ts`):
All routes use `getContext(container, req)` for workspace scoping (AC-U4).

1. `POST /agents/:id/eval-cases` -- Create eval case. Schema: `{ params: IdParams, body: CreateEvalCaseInput }`. Call `service.createCase(workspaceId, agentId, body)`. Return 201.
2. `GET /agents/:id/eval-cases` -- List eval cases. Schema: `{ params: IdParams }`. Return array.
3. `GET /eval-cases/:id` -- Get single case. Schema: `{ params: IdParams }`. Return case or 404.
4. `PUT /eval-cases/:id` -- Update case. Schema: `{ params: IdParams, body: UpdateEvalCaseInput }`. Return updated case or 404.
5. `DELETE /eval-cases/:id` -- Delete case. Schema: `{ params: IdParams }`. Return `{ ok: true }` or 404.
6. `POST /agents/:id/eval-runs` -- Start batch. Schema: `{ params: IdParams }`. Edge cases: zero cases -> 400, concurrent batch -> 409. Return 202 with `{ batch_id }`.
7. `POST /eval-cases/:id/run` -- Run single case. Schema: `{ params: IdParams }`. Return eval run result.
8. `GET /agents/:id/eval-batches` -- List batches. Schema: `{ params: IdParams, querystring: z.object({ range: TimeRangeFilter }) }`. Return array.
9. `GET /eval-batches/:id` -- Get batch with runs. Schema: `{ params: IdParams }`. Return batch + runs or 404.
10. `GET /eval-dashboard` -- Workspace dashboard. Return `EvalAgentSummary[]`.
11. `GET /agents/:id/eval-dashboard` -- Per-agent dashboard. Schema: `{ params: IdParams, querystring: z.object({ range: TimeRangeFilter }) }`. Return `EvalDashboard`.
12. `GET /eval-batches/:a/compare/:b` -- Compare. Schema: `{ params: z.object({ a: z.string().uuid(), b: z.string().uuid() }) }`. Return comparison data.
13. `POST /agents/:id/promote` -- Promote agent to a previous version's config. Schema: `{ params: IdParams, body: z.object({ version: z.number().int() }) }`. Calls `service.promoteVersion(workspaceId, agentId, version)`. Returns updated agent. Used by the CompareModal's "Promote" button.

**Module registration** (`modules/index.ts`):
Add `import evals from './evals/routes.js';` and `evals` to the `modules` record.

**Stale batch reaping** (`app.ts`):
After the existing `ReviewService.reapStaleRuns()` call, add:
```
const evalsService = new EvalsService(container);
const reapedBatches = await evalsService.reapStaleBatches();
if (reapedBatches > 0) app.log.info({ reapedBatches }, 'reaped stale eval batches on boot');
```
Wrap in try/catch (non-fatal, same pattern).

**Skills:** `fastify-best-practices`, `zod`, `typescript-expert`, `security`
**Tests:**
- `server/src/modules/evals/routes.it.test.ts` (integration) -- test CRUD routes, batch start (202), concurrent batch rejection (409), time-range filtering, compare endpoint. Uses `buildApp` + `app.inject()` pattern.
**Depends on:** Step 4
**Addresses:** AC-U4, AC-E2, AC-E4, AC-E6, AC-E7, AC-S4, AC-UB4, AC-UB5

---

### Step 6: Client -- TanStack Query Hooks for Evals

**Package:** client
**Files:**
- `client/src/lib/hooks/evals.ts` (create)
- `client/src/lib/hooks/index.ts` (modify -- add barrel export if it exists, otherwise hooks are imported directly)
**What:** Data-fetching hooks for all eval pipeline endpoints.

Hooks to create:
- `useEvalCases(agentId)` -- `GET /agents/:id/eval-cases`. Returns `EvalCaseRecord[]`.
- `useEvalCase(caseId)` -- `GET /eval-cases/:id`. Returns `EvalCaseRecord`.
- `useCreateEvalCase(agentId)` -- mutation `POST /agents/:id/eval-cases`. Invalidates `["eval-cases", agentId]`.
- `useUpdateEvalCase()` -- mutation `PUT /eval-cases/:id`. Invalidates eval-cases.
- `useDeleteEvalCase()` -- mutation `DELETE /eval-cases/:id`. Invalidates eval-cases.
- `useRunEvalCase()` -- mutation `POST /eval-cases/:id/run`. Returns run result.
- `useStartEvalBatch(agentId)` -- mutation `POST /agents/:id/eval-runs`. Returns `{ batch_id }`. Invalidates eval-batches.
- `useEvalBatches(agentId, range)` -- `GET /agents/:id/eval-batches?range=`. Returns `EvalBatchRecord[]`.
- `useEvalBatch(batchId)` -- `GET /eval-batches/:id`. Returns batch + runs. `refetchInterval: 4000` when status is 'queued' or 'running' (AC-E8 polling). **Toast on completion:** Add a `useEffect` watching `data.status` — when it transitions to `'done'`, fire `notify.success('Eval batch completed: N/M passed')`. When `'failed'`, fire `notify.error('Eval batch failed')` (AC-E8).
- `useEvalDashboard()` -- `GET /eval-dashboard`. `refetchInterval: 4000` (AC-S3). Toast on batch completion same as above.
- `useAgentEvalDashboard(agentId, range)` -- `GET /agents/:id/eval-dashboard?range=`.
- `useCompareBatches(batchIdA, batchIdB)` -- `GET /eval-batches/:a/compare/:b`. Enabled only when both IDs provided.
- `usePromoteAgentVersion(agentId)` -- mutation `POST /agents/:id/promote` with body `{ version }`. Invalidates agent + eval queries. Uses the dedicated promote route (Step 5, route 13), not the generic agent update route.

All hooks follow existing patterns in `hooks/agents.ts`: `useQuery`/`useMutation` with `api.get`/`api.post`/`api.put`/`api.del`.

**Skills:** `react-best-practices`, `react-frontend-best-practices`, `typescript-expert`
**Tests:** Hooks tested transitively via component tests.
**Depends on:** Step 1
**Addresses:** AC-E8, AC-S2, AC-S3, AC-O1

---

### Step 7: Client -- FindingCard "Turn into eval case" Button

**Package:** client
**Files:**
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` (modify)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/constants.ts` (modify -- if adding icon)
**What:** Add the "Turn into eval case" button to the FindingCard action row.

Implementation:
1. Add a new `Button` after the "Accept" and "Dismiss" buttons in the actions row. Icon: `"FlaskConical"` (Lucide, verify it exists in the `Icon` registry; if not, use `"TestTube2"` or another registered icon). Text: "Eval case".
2. The button is **disabled** when neither `f.accepted_at` nor `f.dismissed_at` is set (AC-S1).
3. On click:
   - Check that diff data is available (the parent component must pass `fileDiff: string | undefined` as a new prop to FindingCard). If `fileDiff` is undefined/empty, show an error toast (`notify.error(...)`) and return (AC-UB1).
   - Call `onCreateEvalCase?.(evalCaseData)` callback (new optional prop), where `evalCaseData` contains: `name` (derived from finding title), `input_diff` (the file's diff), `expected_output` (array with one `ExpectedOutputItem` -- `type: 'must_find'` if accepted, `type: 'must_not_flag'` if dismissed, with `file`, `start_line`, `end_line`, `severity`, `category`, `title` from the finding).
4. The parent component (`FindingsPanel` or `ReviewRunAccordion`) wires the callback to open the eval case editor modal (Step 10), passing the pre-populated data.

**Note on the `fileDiff` prop:** The diff data is already loaded client-side in the PR detail page's diff tab. The parent will need to resolve the file's diff from the loaded PR diff data. If not available in the findings context, the button shows an error toast per AC-UB1.

**Skills:** `react-best-practices`, `typescript-expert`
**Tests:**
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx` (modify) -- add tests: button disabled when finding not accepted/dismissed, button calls onCreateEvalCase with correct data.
**Depends on:** Step 1, Step 6
**Addresses:** AC-E1, AC-S1, AC-UB1

---

### Step 8: Client -- Eval Dashboard Page

**Package:** client
**Files:**
- `client/src/app/eval-dashboard/page.tsx` (create)
- `client/src/app/eval-dashboard/_components/EvalDashboardView/EvalDashboardView.tsx` (create)
- `client/src/app/eval-dashboard/_components/EvalDashboardView/index.ts` (create)
- `client/src/app/eval-dashboard/_components/EvalDashboardView/styles.ts` (create)
- `client/src/app/eval-dashboard/_components/EvalDashboardView/constants.ts` (create)
- `client/src/app/eval-dashboard/_components/AgentEvalCard/AgentEvalCard.tsx` (create)
- `client/src/app/eval-dashboard/_components/AgentEvalCard/index.ts` (create)
- `client/src/app/eval-dashboard/_components/AgentEvalCard/styles.ts` (create)
- `client/src/components/app-shell/hooks/useShellContext.ts` (modify -- or wherever nav extension happens)
**What:** Workspace-wide Eval Dashboard page with agent cards and recent runs table. Sidebar nav extension.

**Sidebar navigation (RESOLVED):**
Create a local `AppSidebar` wrapper component that renders the vendor `Sidebar` plus an additional nav item for "Eval Dashboard" in the SKILLS LAB section (after "Conventions"), following the `LOCAL_SECTIONS` pattern from INSIGHTS.md. The wrapper extends the `NAV` array locally with `{ key: 'eval', label: 'Eval Dashboard', href: '/eval-dashboard', icon: 'FlaskConical', section: 'SKILLS_LAB' }` and passes the extended array to the vendor `Sidebar`. If the vendor `Sidebar` does not accept a NAV prop, create a thin layout wrapper in `AppShell` that injects the extra nav item after the vendor sidebar renders.

**Dashboard page** (`page.tsx` + `EvalDashboardView`):
- Uses `useEvalDashboard()` hook with 4s polling (AC-S3).
- Header: "Eval Dashboard" title.
- Agent cards grid: one `AgentEvalCard` per agent, showing: agent name, version badge, last run timestamp, case count, recall/precision/citation_accuracy percentages as colored badges. Click navigates to `/eval-dashboard?agent={id}`.
- Recent eval runs table below: columns for agent name, ran_at, version, recall/precision/citation bars (progress bar components), pass fraction, cost. **Pass/fail indicators must use icon + text, not color alone** (accessibility NFR).
- Breadcrumb: `[{ label: "Skills Lab" }, { label: "Eval Dashboard" }]`.
- **Accessibility:** Dashboard and agent cards must be keyboard-navigable (use semantic HTML: `<button>`, `<a>`, proper `tabindex`). All interactive elements must be reachable via Tab key.

**Skills:** `react-best-practices`, `react-frontend-best-practices`, `next-best-practices`, `typescript-expert`
**Tests:**
- `client/src/app/eval-dashboard/_components/EvalDashboardView/EvalDashboardView.test.tsx` -- renders agent cards, handles empty state.
**Depends on:** Step 1, Step 6
**Addresses:** AC-S3, AC-S4, AC-E8

---

### Step 9: Client -- Agent Detail View + Compare Modal

**Package:** client
**Files:**
- `client/src/app/eval-dashboard/_components/AgentEvalDetail/AgentEvalDetail.tsx` (create)
- `client/src/app/eval-dashboard/_components/AgentEvalDetail/index.ts` (create)
- `client/src/app/eval-dashboard/_components/AgentEvalDetail/styles.ts` (create)
- `client/src/app/eval-dashboard/_components/AgentEvalDetail/constants.ts` (create)
- `client/src/app/eval-dashboard/_components/MetricTrendChart/MetricTrendChart.tsx` (create)
- `client/src/app/eval-dashboard/_components/MetricTrendChart/index.ts` (create)
- `client/src/app/eval-dashboard/_components/CompareModal/CompareModal.tsx` (create)
- `client/src/app/eval-dashboard/_components/CompareModal/index.ts` (create)
- `client/src/app/eval-dashboard/_components/CompareModal/styles.ts` (create)
**What:** Per-agent eval detail view (drilldown from dashboard) and batch comparison modal.

**Agent detail view** (`AgentEvalDetail`):
- Shown when `?agent={id}` query param is present on the eval dashboard page.
- Breadcrumb: Eval Dashboard > {Agent Name}.
- Header: agent name, version badge, "Run eval" button (disabled while batch running with a **spinner/loading indicator** next to it -- AC-S2), agent selector dropdown (switch between agents), time range filter (7d/30d/90d/all, default 30d -- AC-S4).
- Alert banner: shown when latest batch shows regression (e.g., "Precision dipped 2pts on vN"). Compare current vs previous batch deltas.
- Three metric cards: Recall, Precision, Citation Accuracy -- current value, delta from previous, mini sparkline (Recharts `<Sparkline>` or simple `<Line>` in a tiny container).
- Metric Trend chart (`MetricTrendChart`): Recharts `<LineChart>` with 3 lines (recall, precision, citation_accuracy). X-axis: batch `ran_at`. Y-axis: 0 to 1. Data from `useAgentEvalDashboard(agentId, range)`.
- Recent Runs table: ran_at, version, recall/precision/citation bars, pass fraction, cost. Checkbox column for selecting exactly 2 runs. **Pass/fail indicators must use icon + text, not color alone** (accessibility NFR).
- "Compare" button: enabled when exactly 2 runs selected. Opens `CompareModal`.
- **Accessibility:** Detail view must be keyboard-navigable. Checkboxes and buttons reachable via Tab. Metric cards use `aria-label` for screen readers.

**Compare modal** (`CompareModal`):
- Overlay modal (focus-trapped, Escape to close -- accessibility per spec NFR).
- Header: "Compare runs - v{A} vs v{B}".
- Metric deltas section: recall, precision, citation_accuracy, pass fraction, cost. Each shows old value, new value, delta. Green = improvement, red = regression.
- System prompt diff: render the two versions' `system_prompt` as a side-by-side diff. Use a simple text diff (split lines, mark additions/removals with color). No need for a full diff library -- the prompts are relatively short.
- Collapsed "Case changes" section: expandable list of cases whose pass/fail flipped between the two batches.
- "Promote v{N}" button: calls `usePromoteAgentVersion()` mutation, passing the selected version's config. On success, invalidate agent + eval queries and show success toast (AC-E6).

**Skills:** `react-best-practices`, `react-frontend-best-practices`, `typescript-expert`
**Tests:**
- `client/src/app/eval-dashboard/_components/CompareModal/CompareModal.test.tsx` -- renders deltas, promote button calls mutation.
**Depends on:** Step 1, Step 6, Step 8
**Addresses:** AC-E6, AC-E7, AC-E8, AC-S4

---

### Step 10: Client -- Agent Editor "Evals" Tab + Eval Case Editor Modal

**Package:** client
**Files:**
- `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx` (create)
- `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/index.ts` (create)
- `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/styles.ts` (create)
- `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/constants.ts` (create)
- `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` (modify -- add Evals tab)
- `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (modify -- add 'evals' to TABS)
- `client/src/app/agents/[id]/page.tsx` (modify -- add 'evals' to VALID_TABS)
- `client/src/components/eval-case-editor/EvalCaseEditorModal.tsx` (create)
- `client/src/components/eval-case-editor/index.ts` (create)
- `client/src/components/eval-case-editor/styles.ts` (create)
- `client/src/components/eval-case-editor/constants.ts` (create)
**What:** Add the "Evals" tab to the agent editor and the shared eval case editor modal.

**Evals tab** (`EvalsTab`):
- Receives `agent: Agent` prop.
- Header section: eval metrics summary (recall, precision, citation_accuracy, traces passed/total from `useAgentEvalDashboard`). "View full dashboard" link to `/eval-dashboard?agent={agent.id}`.
- Eval cases list: uses `useEvalCases(agent.id)`. Each row shows: name, expected output summary (e.g., "1 must_find, 0 must_not_flag"), severity/category badges, pass/fail indicator (green check or red X icon + text -- not color-only, per accessibility NFR), action buttons:
  - "Run" -- calls `useRunEvalCase` mutation (AC-E4).
  - "Edit" -- opens `EvalCaseEditorModal` in edit mode.
  - "Delete" -- confirmation dialog, then `useDeleteEvalCase` mutation (AC-E10).
- "Run all evals" button: calls `useStartEvalBatch`. Disabled while a batch is in progress (AC-S2) with a **spinner/loading indicator** next to the disabled button -- check batch status from `useEvalBatches`. **Error handling:** `useStartEvalBatch` `onError` handler checks HTTP status: if 409, show toast "A batch is already running for this agent" (AC-UB5). If 400 with zero-cases error, show toast "No eval cases to run" (EDGE-1).
- "New eval case" button: opens `EvalCaseEditorModal` in create mode (AC-E9).

**Agent editor integration:**
- Add `{ key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" }` to `TABS` in `constants.ts`. (Verify `"FlaskConical"` exists in the Icon registry; if not, use `"TestTube2"` or `"Beaker"`.)
- Add `"evals"` to `VALID_TABS` in `page.tsx`.
- Add `{tab === "evals" && <EvalsTab agent={agent} />}` in `AgentEditor.tsx`.

**Eval case editor modal** (`EvalCaseEditorModal`):
- Shared modal used by both "Turn into eval case" (pre-populated, Step 7) and "New eval case" (empty, AC-E9).
- Placed in `components/eval-case-editor/` since it's consumed from multiple pages (FindingCard context + Agent editor).
- Focus-trapped, Escape to close (accessibility per spec NFR).
- Fields:
  - Name (text input, required, max 255 chars).
  - Input section with three sub-tabs: "Diff" (textarea with monospace font for unified diff), "Files" (JSON textarea), "PR meta" (JSON textarea).
  - Expected output (JSON editor textarea with monospace font). "Valid JSON" indicator (green/red based on parse result). "Finding skeleton" button inserts a template `ExpectedOutputItem` JSON into the textarea (AC-O2).
  - Notes (optional textarea).
- Footer:
  - "Run on save" toggle (default: enabled, stored in component state) (AC-O1).
  - Last run status (if editing existing case and runs exist): pass/fail, summary.
  - "Cancel" button -- closes modal.
  - "Run case" button -- calls `useRunEvalCase`, shows result inline.
  - "Save" button -- calls `useCreateEvalCase` or `useUpdateEvalCase`. If "Run on save" enabled, also triggers `useRunEvalCase` after successful save (AC-E5).
- Validation: client-side `JSON.parse` on expected_output before submit. Show inline errors on parse failure (AC-UB4).

**Skills:** `react-best-practices`, `react-frontend-best-practices`, `typescript-expert`
**Tests:**
- `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx` -- renders case list, handles empty state, run all button disabled while batch running.
- `client/src/components/eval-case-editor/EvalCaseEditorModal.test.tsx` -- validates JSON, skeleton button inserts template, save triggers run when toggle on.
**Depends on:** Step 1, Step 6
**Addresses:** AC-E5, AC-E9, AC-O1, AC-O2, AC-S2, AC-UB4

---

## Parallelization Strategy

The multi-agent execution is structured as follows:

```
Step 1 (Shared Contracts) ──────────────────────────────┐
                                                         │
Step 2 (DB Schema) ─── Step 3 (Migration) ──┐           │
                                             │           │
                                             ▼           ▼
                                     Step 4 (Server)     Step 6 (Client Hooks) ──┐
                                             │                                    │
                                             ▼                                    ├── Step 7 (FindingCard)
                                     Step 5 (Routes)                              ├── Step 8 (Dashboard)
                                                                                  ├── Step 9 (Detail+Compare)
                                                                                  └── Step 10 (Evals Tab)
```

**Server agent:** Steps 1 → 2 → 3 → 4 → 5 (sequential, each depends on prior)
**Client agent:** Steps 1 → 6 → [7, 8, 9, 10] (Step 6 first, then 7-10 can be parallelized)

Step 1 must complete before either agent proceeds. Steps 2-5 (server) and Steps 6-10 (client) can execute in parallel after Step 1.

## Proactive Skills That Will Fire

- `engineering-insight` -- WILL fire. This plan modifies 20+ files across two packages.
- `breaking-change` -- WILL fire. New API routes are added (12 endpoints). However, these are all additive (no existing routes changed), so no breaking changes expected.
- `response-schema` -- WILL fire. New API response shapes introduced.
- `deprecation-policy` -- will NOT fire. No public APIs removed.
- `semver-discipline` -- will NOT fire. No published package version bump needed (not published packages).

## Risk Assessment

1. **UnifiedDiff parsing from text** -- The `parseDiffToUnifiedDiff` helper must correctly parse arbitrary unified diff text into the `UnifiedDiff` shape (with `path`, `additions`, `deletions`, `hunks` containing `newLineNumbers`). Mitigation: write thorough unit tests with diverse diff formats (single file, multi-file, binary, rename, empty hunks). The `newLineNumbers` array in each hunk is critical for grounding -- parse the `@@` hunk headers to extract new-side line numbers.

2. **Concurrent batch guard race condition** -- The in-memory lock + DB check may have a TOCTOU gap between checking and creating the batch. Mitigation: use a DB-level unique partial index: `CREATE UNIQUE INDEX ON eval_batches (owner_id) WHERE status IN ('queued', 'running')`. This provides an atomic guard. The in-memory lock is a fast-path; the DB constraint is the authoritative guard.

3. **Large `input_diff` causing LLM context overflow** -- Eval cases with large diffs may exceed the model's context window. Mitigation: enforce the 500KB `input_diff` size limit server-side. The reviewer-core engine's map-reduce strategy will automatically split large diffs. Document this behavior.

4. **Stale batch reaping on boot timing** -- If the server crashes mid-batch and restarts, running batches are reaped to 'failed'. This is correct behavior (spec edge case 11) but individual eval_runs for in-progress cases may be left without results. Mitigation: the reaper also sets 'queued' batches to 'failed'. Runs that were not yet created simply don't exist. Runs that were created but not completed will have `pass: null` and no error, which is acceptable.

5. **Vendor sidebar nav integration** -- The vendor `Sidebar` component reads `NAV` directly and cannot be modified. Adding the eval dashboard to the sidebar requires working around this constraint. Mitigation: provide the eval dashboard link from the agent editor's Evals tab ("View full dashboard" link) and consider adding a nav item via a non-vendor sidebar extension mechanism. If a clean sidebar integration is needed later, it would require a vendor update (out of scope).

6. **Icon availability** -- Icons like `FlaskConical` or `TestTube2` may not be registered in the vendor `Icon` registry. Mitigation: check `client/src/vendor/ui/icons.tsx` before using. Fall back to a registered icon like `"Sparkles"` or `"Activity"` if needed.

## Out of Scope

- **Skill-level evals** -- Schema supports `owner_kind: 'skill'` but execution logic for skills is not implemented (spec non-goal).
- **Scheduled/automated eval runs** -- All runs are user-initiated (spec non-goal).
- **Multi-agent orchestration evals** -- Not covered (spec non-goal).
- **Data retention policies** -- Unbounded retention for v1 (spec non-goal).
- **Export/import of eval cases** -- Not covered (spec non-goal).
- **Per-case recall/precision** -- Recall and precision are batch-level only (spec out of scope).
- **Trend chart for single-case runs** -- Trend plots batch runs only (spec out of scope).
