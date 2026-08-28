# Implementation Plan: Multi-Agent Review

**Spec:** `specs/multi-agent-review/multi-agent-review.spec.md`
**Scope:** server, client
**Estimated complexity:** high
**Multi-agent execution:** yes (server and client can be implemented in parallel after Steps 1-3)
**Created:** 2026-08-25

## Context

DevDigest users with multiple review agents currently have no coordinated way to run all of them against a single PR and compare outputs side by side. The existing "Run All" flow (`POST /pulls/:id/review {all:true}`) runs agents independently and presents results as separate entries. This feature introduces a dedicated Multi-Agent Review experience with:
- A configuration page to pick a PR and select agents with pre-run cost/duration estimates
- Parallel agent execution with live per-agent SSE progress
- A results page with side-by-side columns and a "Where Agents Disagree" conflict view

The `multi_agent_runs` table already exists in the DB schema. The `MultiAgentRun`, `AgentColumn`, `Conflict`, and `ConflictTake` Zod contracts already exist in `server/src/vendor/shared/contracts/observability.ts` and are already exported from both server and client `vendor/shared/index.ts`.

## Requirements Summary

The spec defines 4 ubiquitous criteria (sidebar nav, persist multi-agent runs, FK linkage, leave existing flows unchanged), 10 event-driven criteria (configure page, estimates, run trigger, server execution, redirect, results page, SSE, final stats, conflict computation, conflict filter), 2 state-driven criteria (polling, repo switching), 1 optional-feature criterion (missing historical data), and 7 unwanted-behavior criteria (validation errors, partial failures, SSE drops).

## Spec Coverage Matrix

| Criterion | EARS Pattern | Plan Step(s) | Status |
|-----------|-------------|--------------|--------|
| AC-1: Sidebar nav item for Multi-Agent Review | Ubiquitous | Step 9 | COVERED |
| AC-2: Persist every multi-agent run as a row in `multi_agent_runs` | Ubiquitous | Step 3, Step 4 | COVERED |
| AC-3: Link agent_runs to parent multi-agent run via nullable `multi_agent_run_id` FK | Ubiquitous | Step 1, Step 4 | COVERED |
| AC-4: Leave existing single-agent and "run all" flows unchanged; `multi_agent_run_id` is NULL for those | Ubiquitous | Step 1 | COVERED |
| AC-5: Configure page with PR picker, agent checkboxes, estimate panel | Event-Driven | Step 7 | COVERED |
| AC-6: Pre-run estimate (sum of costs, max of durations) from historical data | Event-Driven | Step 3, Step 7 | COVERED |
| AC-7: "Run" button sends POST /pulls/:prId/multi-agent-run with selected agent IDs | Event-Driven | Step 4, Step 7 | COVERED |
| AC-8: Server creates multi_agent_runs row, agent_runs rows, executes in parallel via ReviewRunExecutor | Event-Driven | Step 4 | COVERED |
| AC-9: Redirect to /multi-agent-review/[id] after successful run creation | Event-Driven | Step 7 | COVERED |
| AC-10: Results page fetches multi-agent run + associated agent runs | Event-Driven | Step 5, Step 8 | COVERED |
| AC-11: SSE per-agent progress via useRunEvents while runs in progress | Event-Driven | Step 8 | COVERED |
| AC-12: Final stats (duration, tokens, cost, findings, score) in column headers on completion | Event-Driven | Step 3, Step 4, Step 8 | COVERED -- `MultiAgentAgentColumn` extends `AgentColumn` with `tokens_in`/`tokens_out` |
| AC-13: Server-side conflict computation (group by file + overlapping line ranges) | Event-Driven | Step 4, Step 5 | COVERED -- `computeConflicts(ConflictFinding[], agentIds)` uses `end_line` from DB query, decoupled from `AgentColumnFinding` |
| AC-14: "Show only conflicts" toggle hides unanimous groups | Event-Driven | Step 8 | COVERED |
| AC-15: Poll GET endpoint at 4s while any agent is running | State-Driven | Step 6, Step 8 | COVERED |
| AC-16: Configure page reflects active repo from RepoProvider; PR list refreshes on repo switch | State-Driven | Step 7 | COVERED |
| AC-17: "?" for agents with no historical data; aggregate annotated as partial | Optional Feature | Step 3, Step 7 | COVERED |
| AC-18: 400 for zero agent IDs | Unwanted | Step 4 | COVERED |
| AC-19: 404 for agent ID not in workspace | Unwanted | Step 4 | COVERED |
| AC-20: 404 for PR not in workspace | Unwanted | Step 4 | COVERED |
| AC-21: Partial failure -- failed agent marked failed, others succeed | Unwanted | Step 4, Step 8 | COVERED |
| AC-22: All agents fail -- full-run error state | Unwanted | Step 8 | COVERED |
| AC-23: SSE drop -- "Connection lost" indicator + polling fallback | Unwanted | Step 8 | COVERED |
| AC-24: 404 for non-existent multi-agent run ID | Unwanted | Step 5 | COVERED |

## Recommendations Applied

1. **Computed status over stored status** -- the spec's open question about a `status` column on `multi_agent_runs` is resolved by computing status on read from constituent agent_runs. This avoids synchronization complexity and is consistent with the spec's suggestion.
2. **Reuse ReviewRunExecutor** -- the existing `ReviewRunExecutor.executeRuns()` already handles parallel agent execution, diff loading, intent classification, error isolation, and SSE streaming. The multi-agent flow reuses it directly rather than reimplementing parallel execution.
3. **Exact line-range overlap for conflicts** -- the spec's open question about the disagreement grouping algorithm is resolved with exact `[start_line, end_line]` interval overlap on the same file, as the spec suggests. This is the simplest correct approach.
4. **Scrollable columns for 5+ agents** -- the spec's open question about layout for many agents is resolved with horizontally scrollable columns, matching the spec's suggestion.
5. **Per-agent breakdown in estimate panel** -- the spec's open question about estimate granularity is resolved by showing both aggregate and per-agent breakdown.
6. **New `multi-agent-review` server module** -- this feature has its own DB table, dedicated routes, and a service layer with conflict computation logic. Per the onion-architecture guidance and the fact that existing features like onboarding, risk-brief, and evals each have their own module, this warrants a new module registered in `modules/index.ts`.

## Architecture Constraints

- `vendor/shared/` -- extend with new files only, never edit existing contracts. The `observability.ts` contract already contains the needed Zod schemas; a new contract file will be added for the multi-agent run request body. Source: `CLAUDE.md`, `server/CLAUDE.md`.
- Modules are registered statically in `server/src/modules/index.ts`. Source: `CLAUDE.md`.
- Migrations are NOT applied on boot -- plan includes explicit migration step. Source: `CLAUDE.md`.
- Routes must call `getContext(container, req)` first. Source: `server/CLAUDE.md`.
- Routes delegate to Service; Service delegates to Repository. No Drizzle operators in Service. Source: `server/INSIGHTS.md` (2026-08-15, 2026-08-07).
- `client/src/vendor/shared/` is a physical copy, not a symlink. New contract files must be copied to client. Source: `client/INSIGHTS.md` (2026-08-06).
- Nav items injected via side-effect mutation of `NAV` array in `patch-nav.ts`. Source: `client/INSIGHTS.md` (2026-08-20).
- Existing `createAgentRun` in `run.repo.ts` does not accept `multiAgentRunId` -- the function signature must be extended. Backward compatibility is preserved because the field is nullable.

## Pre-implementation Checklist

- [x] Migration needed? **Yes** -- add nullable `multi_agent_run_id` FK column to `agent_runs` table.
- [x] New module needed? **Yes** -- `server/src/modules/multi-agent-review/` registered in `modules/index.ts`.
- [x] New shared contracts needed? **Yes** -- new file `server/src/vendor/shared/contracts/multi-agent-api.ts` for the request body schema; copy to client.
- [x] New adapter needed? **No** -- reuses existing `ReviewRunExecutor`, `ReviewRepository`, `AgentsRepository`.

## Steps

### Step 1: Add `multi_agent_run_id` FK column and `agent_name` column to `agent_runs` schema

**Package:** server
**Files:**
- `server/src/db/schema/runs.ts` (modify)
**What:** Two additive schema changes to `agentRuns`:
1. Add nullable `multiAgentRunId` column with FK reference to `multiAgentRuns.id` and `onDelete: 'set null'`. Existing rows get NULL; existing `createAgentRun` callers are unaffected (field defaults to null).
2. Add `agentName: text('agent_name').notNull()` column. Stores the agent's display name at run creation time so the name is preserved after agent deletion (spec edge case 5: "agent name from the `agent_runs` record"). Existing rows will need a default value in the migration -- use `''` as the default for the backfill, then remove the default after migration (standard Postgres pattern for adding NOT NULL to existing tables).
**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`
**Tests:** Run `pnpm typecheck` to verify schema compiles. The migration (Step 2) validates DB-level correctness.
**Depends on:** none
**Addresses:** AC-3, AC-4

### Step 2: Generate and apply the Drizzle migration

**Package:** server
**Files:**
- `server/src/db/migrations/XXXX_add_multi_agent_run_id.sql` (create -- auto-generated by `pnpm db:generate`)
**What:** Run `pnpm db:generate` to produce a single migration SQL that adds both new columns to `agent_runs`:
- `multi_agent_run_id UUID REFERENCES multi_agent_runs(id) ON DELETE SET NULL` (nullable FK)
- `agent_name TEXT NOT NULL DEFAULT ''` then `ALTER COLUMN agent_name DROP DEFAULT` (backfill pattern for NOT NULL on existing table)

Add an explicit `CREATE INDEX` on `agent_runs(multi_agent_run_id)` if Drizzle does not auto-generate one (PostgreSQL does NOT auto-index FK columns). Apply with `pnpm db:migrate`.
**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`
**Tests:** After `pnpm db:migrate`, verify via psql that the column exists and is nullable.
**Depends on:** Step 1
**Addresses:** AC-3

### Step 3: Add new shared contract for multi-agent run request + estimate endpoint

**Package:** server, client
**Files:**
- `server/src/vendor/shared/contracts/multi-agent-api.ts` (create)
- `server/src/vendor/shared/index.ts` (modify -- add barrel export)
- `client/src/vendor/shared/contracts/multi-agent-api.ts` (create -- copy from server)
- `client/src/vendor/shared/index.ts` (modify -- add barrel export)
**What:** Create a new contract file containing:
- `MultiAgentRunRequest` -- Zod schema: `{ agent_ids: z.array(z.string().uuid()).min(1) }`
- `MultiAgentRunResponse` -- Zod schema: `{ id: string, runs: ReviewRunTarget[] }` (the POST response before full column data is available)
- `AgentEstimate` -- Zod schema: `{ agent_id: string, agent_name: string, cost_usd: number | null, duration_ms: number | null }` (for pre-run estimate)
- `MultiAgentEstimate` -- Zod schema: `{ agents: AgentEstimate[], total_cost_usd: number | null, total_duration_ms: number | null, is_partial: boolean }`
- `MultiAgentAgentColumnSchema` -- extends `AgentColumnSchema` with `tokens_in: z.number().int().nullable()` and `tokens_out: z.number().int().nullable()` (AC-12: tokens in column header; these fields exist on `agent_runs` but are absent from the uneditable `AgentColumn` contract in `observability.ts`)
- `MultiAgentRunDetailSchema` -- extends `MultiAgentRunSchema` with `columns: z.array(MultiAgentAgentColumnSchema)` (overrides the base `columns` field to include token data)
- Export inferred types: `MultiAgentAgentColumn`, `MultiAgentRunDetail`

The `GET /multi-agent-run/:id` endpoint returns `MultiAgentRunDetail` (not `MultiAgentRun`). The POST request and estimate endpoints use the other schemas. Do NOT edit `observability.ts`.
**Skills:** `zod`, `typescript-expert`
**Tests:** `pnpm typecheck` on both server and client.
**Depends on:** none
**Addresses:** AC-6, AC-17, AC-2

### Step 4: Create the `multi-agent-review` server module (routes, service, repository)

**Package:** server
**Files:**
- `server/src/modules/multi-agent-review/routes.ts` (create)
- `server/src/modules/multi-agent-review/service.ts` (create)
- `server/src/modules/multi-agent-review/repository.ts` (create)
- `server/src/modules/multi-agent-review/conflict.ts` (create)
- `server/src/modules/index.ts` (modify -- register the new module)
- `server/src/modules/reviews/repository/run.repo.ts` (modify -- extend `createAgentRun` to accept optional `multiAgentRunId`)
**What:**

**routes.ts** -- Fastify plugin with 3 endpoints:
1. `POST /pulls/:prId/multi-agent-run` -- Zod-validated body (`MultiAgentRunRequest`). Calls `getContext`, then `service.createAndExecute(workspaceId, prId, agentIds)`. Rate-limited (10 req/min). Returns `MultiAgentRunResponse`.
2. `GET /multi-agent-run/:id` -- Calls `getContext` (workspace-scoped), then `service.getMultiAgentRun(workspaceId, multiAgentRunId)`. Returns `MultiAgentRunDetail` (from `multi-agent-api.ts`). **Note: no `prId` in path** — the client navigates to `/multi-agent-review/[id]` with only the run ID; the service validates workspace ownership directly on the `multi_agent_runs` row.
3. `GET /agents/estimates` -- Calls `getContext`, then `service.getEstimates(workspaceId)`. Returns `MultiAgentEstimate`.

**service.ts** -- `MultiAgentReviewService`:
- `createAndExecute(workspaceId, prId, agentIds)`:
  1. Validate PR exists and belongs to workspace (via `reviewRepo.getPull`).
  2. Validate each agentId exists and belongs to workspace (via `agentsRepo.getById`). Return 404 for any invalid agent.
  3. Return 400 if agentIds is empty (Zod `.min(1)` handles this at the route level, but defense-in-depth).
  4. Insert `multi_agent_runs` row via `repo.createMultiAgentRun`.
  5. Create `agent_runs` rows (via the existing `createAgentRun` with the new `multiAgentRunId` parameter).
  6. Fire-and-forget `reviewService.executor.executeRuns(...)` (reuse the existing executor).
  7. Return the multi-agent run ID + run targets.

- `getMultiAgentRun(workspaceId, multiAgentRunId)`:
  1. Fetch the `multi_agent_runs` row (workspace-scoped; 404 if not found or wrong workspace).
  2. Fetch all `agent_runs` where `multi_agent_run_id = id` joined with `reviews` + `findings` for column display data. Use `agent_runs.agent_name` directly (not a JOIN with `agents`) -- name is preserved even after agent deletion (Gap 4 fix).
  3. Build `MultiAgentAgentColumn[]` from the run data, populating `tokens_in`/`tokens_out` from `agent_runs.tokens_in`/`agent_runs.tokens_out`.
  4. Fetch raw `ConflictFinding[]` via `repo.getFindingsForConflict(multiAgentRunId)` -- includes `start_line` AND `end_line` from the `findings` table (Gap 2 fix).
  5. Compute `Conflict[]` via `computeConflicts(conflictFindings, agentIds)` (delegated to `conflict.ts`).
  6. Compute aggregate stats (total_duration_ms = max, total_cost_usd = sum).
  7. Return shaped as `MultiAgentRunDetail`.

- `getEstimates(workspaceId)`: For each agent in the workspace, fetch the most recent completed `agent_run` row (indexed lookup on `(workspace_id, agent_id, status)` filtered to `status='done'`, ordered by `ran_at DESC`, `LIMIT 1`). Return per-agent cost/duration and aggregates.

**repository.ts** -- `MultiAgentReviewRepository`:
- `createMultiAgentRun(workspaceId, prId)` -- inserts into `multi_agent_runs`, returns ID.
- `getMultiAgentRun(workspaceId, multiAgentRunId)` -- fetches the row, workspace-scoped.
- `getRunsForMultiAgent(multiAgentRunId)` -- fetches all `agent_runs` where `multi_agent_run_id = id`, using `agent_runs.agent_name` directly (no JOIN with `agents`), joined with `reviews`+`findings` for column display data.
- `getFindingsForConflict(multiAgentRunId)` -- fetches raw findings with `start_line` AND `end_line` from the `findings` table (via agent_runs JOIN reviews JOIN findings). Returns `ConflictFinding[]` for use by `computeConflicts()`. This is a separate query from `getRunsForMultiAgent` because `AgentColumnFinding` in the existing contract omits `end_line`.
- `getLatestCompletedRun(workspaceId, agentId)` -- for estimates.
- `getLatestCompletedRuns(workspaceId)` -- batch version: most recent completed run per agent.

**conflict.ts** -- Define internal type and pure function:

```ts
// Internal type — not exported via shared contract
export type ConflictFinding = {
  agent_id: string;
  agent_name: string;
  file: string;
  start_line: number;
  end_line: number;  // available from findings table; absent from AgentColumnFinding
  severity: string;
  category: string;
  title: string;
};

export function computeConflicts(findings: ConflictFinding[], allAgentIds: string[]): Conflict[]
```

Algorithm:
1. Group findings by `file`.
2. Within each file, find overlapping line-range clusters: two findings `[a1, a2]` and `[b1, b2]` overlap if `a1 <= b2 && b1 <= a2`. Use a sweep to merge overlapping findings into groups.
3. For each group, check if agents disagree: different severities, different categories, or some agents did not flag the region (`allAgentIds` provides the full agent set; agents absent from the group get a `'ignored'` take).
4. Build `ConflictTake[]` per agent. Only emit a `Conflict` when at least one agent differs from the others (not all takes identical).

Note: `computeConflicts` receives `ConflictFinding[]` (from `repo.getFindingsForConflict`) — it does NOT receive `AgentColumn[]`. This decouples conflict computation from the display contract and solves the missing `end_line` gap.

**run.repo.ts modification**: Extend `createAgentRun` to accept two new optional parameters: `multiAgentRunId?: string` and `agentName?: string`. Both default to `undefined`/`''` preserving backward compatibility. All existing callers (`ReviewService.runReview`) pass through the agent name (already available at that call site). The `agentName` is stored directly on `agent_runs` so it survives agent deletion.

**Skills:** `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `typescript-expert`, `security`, `onion-architecture`
**Tests:**
- Unit test: `server/src/modules/multi-agent-review/conflict.test.ts` -- test `computeConflicts` with various scenarios (no overlap, exact overlap different severities, partial overlap, single agent, all agents agree).
- Unit test: `server/src/modules/multi-agent-review/service.test.ts` -- test validation logic (empty agents, invalid agent IDs).
- Integration test: `server/src/modules/multi-agent-review/routes.it.test.ts` -- test POST/GET endpoints with inject(), validate 400/404 error cases.
**Depends on:** Step 1, Step 2, Step 3
**Addresses:** AC-2, AC-3, AC-7, AC-8, AC-13, AC-18, AC-19, AC-20, AC-21, AC-24

### Step 5: Implement the GET endpoint for multi-agent run results (server)

**Package:** server
**Files:** (covered by Step 4 -- `routes.ts`, `service.ts`, `repository.ts`)
**What:** This is part of Step 4's implementation. The GET endpoint (`GET /multi-agent-run/:id`) builds the full `MultiAgentRunDetail` response including:
- `columns[]` of type `MultiAgentAgentColumn[]` -- per-agent run status, verdict, score, summary, duration, cost, **tokens_in/tokens_out**, and findings
- `conflicts[]` computed server-side via `computeConflicts(conflictFindings, agentIds)` using raw findings with `end_line` (not `AgentColumnFinding`)
- `total_duration_ms` (max of all agent durations) and `total_cost_usd` (sum)
- Workspace-scoped 404 if the multi-agent run does not exist or belongs to a different workspace
- `pr_id` in the response (so the client can link to the PR detail page if needed)

For the PR number in the response (`pr_number`), join with `pull_requests` to get the GitHub PR number.

For deleted agents (edge case 5): use `agent_runs.agent_name` directly -- the name was stored at run creation time and is unaffected by agent deletion.
**Skills:** `drizzle-orm-patterns`, `fastify-best-practices`
**Tests:** Covered by Step 4's integration test.
**Depends on:** Step 4
**Addresses:** AC-10, AC-13, AC-24

### Step 6: Add client-side TanStack Query hooks for multi-agent review

**Package:** client
**Files:**
- `client/src/lib/hooks/multi-agent-review.ts` (create)
- `client/src/lib/hooks/index.ts` (modify -- add barrel export)
**What:** Create hooks:
- `useMultiAgentRun(multiAgentRunId)` -- `useQuery` for `GET /multi-agent-run/:id` (no `prId` in path -- Gap 1 fix). Polls at 4s while any column has `status === 'running'`. Returns `MultiAgentRunDetail`.
- `useCreateMultiAgentRun()` -- `useMutation` for `POST /pulls/:prId/multi-agent-run` with `{ agent_ids }` body. On success, returns the multi-agent run ID for navigation.
- `useAgentEstimates()` -- `useQuery` for `GET /agents/estimates`. Fetches historical run data for the estimate panel. `staleTime: 60_000` (estimates change slowly).

Import types from `@devdigest/shared` (`MultiAgentRunDetail`, `MultiAgentAgentColumn`, `MultiAgentRunRequest`, `MultiAgentRunResponse`, `MultiAgentEstimate`).
**Skills:** `react-best-practices`, `typescript-expert`
**Tests:** No unit test needed for hooks (they are thin wrappers over `api`). Tested via component tests in Steps 7/8.
**Depends on:** Step 3
**Addresses:** AC-15

### Step 7: Build the Configure page (client)

**Package:** client
**Files:**
- `client/src/app/multi-agent-review/configure/page.tsx` (create)
- `client/src/app/multi-agent-review/configure/_components/ConfigureView/ConfigureView.tsx` (create)
- `client/src/app/multi-agent-review/configure/_components/ConfigureView/index.ts` (create)
- `client/src/app/multi-agent-review/configure/_components/AgentCheckboxList/AgentCheckboxList.tsx` (create)
- `client/src/app/multi-agent-review/configure/_components/AgentCheckboxList/index.ts` (create)
- `client/src/app/multi-agent-review/configure/_components/EstimatePanel/EstimatePanel.tsx` (create)
- `client/src/app/multi-agent-review/configure/_components/EstimatePanel/index.ts` (create)
**What:**

**page.tsx**: Thin page that imports `AppShell` with breadcrumbs `[{ label: "Multi-Agent Review" }, { label: "Configure" }]` and renders `<ConfigureView />`.

**ConfigureView.tsx**:
- Uses `useActiveRepo()` for the current repo context (AC-16).
- Uses `usePulls(repoId)` to populate the PR picker dropdown.
- Uses `useAgents()` to list all agents with checkboxes. Enabled agents checked by default, disabled agents unchecked.
- Uses `useAgentEstimates()` to get historical cost/duration data.
- State: `selectedPrId`, `selectedAgentIds` (Set).
- When selection changes, computes estimate: `totalCost = sum of selected agents' cost_usd` (skip null), `totalDuration = max of selected agents' duration_ms` (skip null). Mark `isPartial` when any selected agent has null cost/duration.
- "Run" button: calls `useCreateMultiAgentRun().mutate({ prId, agent_ids: [...selectedAgentIds] })`. On success, `router.push(/multi-agent-review/${result.id})`.
- Button disabled when no PR selected or no agents selected.

**AgentCheckboxList.tsx**: Renders agent list with checkboxes. Each row shows agent name, provider/model badge, enabled/disabled status. Keyboard-navigable checkboxes with proper labels (AC for accessibility).

**EstimatePanel.tsx**: Displays aggregate estimate with per-agent breakdown. Shows "?" for agents with no historical data (AC-17). Shows "No historical data available" when all agents have no data (edge case 7).
**Skills:** `react-best-practices`, `react-frontend-best-practices`, `next-best-practices`, `typescript-expert`
**Tests:** `client/src/app/multi-agent-review/configure/_components/ConfigureView/ConfigureView.test.tsx` -- test rendering with mocked hooks, test "Run" button disabled states, test estimate calculation.
**Depends on:** Step 6
**Addresses:** AC-5, AC-6, AC-7, AC-9, AC-16, AC-17

### Step 8: Build the Results page (client)

**Package:** client
**Files:**
- `client/src/app/multi-agent-review/[id]/page.tsx` (create)
- `client/src/app/multi-agent-review/[id]/_components/ResultsView/ResultsView.tsx` (create)
- `client/src/app/multi-agent-review/[id]/_components/ResultsView/index.ts` (create)
- `client/src/app/multi-agent-review/[id]/_components/AgentColumnCard/AgentColumnCard.tsx` (create)
- `client/src/app/multi-agent-review/[id]/_components/AgentColumnCard/index.ts` (create)
- `client/src/app/multi-agent-review/[id]/_components/ConflictsSection/ConflictsSection.tsx` (create)
- `client/src/app/multi-agent-review/[id]/_components/ConflictsSection/index.ts` (create)
- `client/src/app/multi-agent-review/[id]/_components/ResultsView/constants.ts` (create)
- `client/src/app/multi-agent-review/[id]/_components/ResultsView/helpers.ts` (create)
**What:**

**page.tsx**: Thin page. Extracts `id` from `params`. Renders `AppShell` with breadcrumbs `[{ label: "Multi-Agent Review" }, { label: "Run #..." }]` and `<ResultsView multiAgentRunId={id} />`.

**ResultsView.tsx**:
- Uses `useMultiAgentRun(multiAgentRunId)` to fetch run data (polls at 4s while running -- AC-15). No `prId` needed on first render -- the hook calls `GET /multi-agent-run/:id` directly (Gap 1 fix).
- For in-progress runs: subscribes each running agent's `run_id` to `useRunEvents([...runningRunIds])` (existing hook -- AC-11). Displays spinner + elapsed time in column header.
- For completed runs: displays final stats in column headers (AC-12).
- Side-by-side column layout using CSS grid or flexbox. Horizontal scroll for 5+ agents.
- Below columns: `<ConflictsSection />` (hidden when only 1 agent -- edge case 1).
- Error states:
  - Single agent failed: show failure message in that column, other columns show results (AC-21).
  - All agents failed: full-run error state with per-agent error messages (AC-22).
- SSE connection drop: the existing `useRunEvents` hook closes the EventSource on error. Add a `connectionLost` state per agent column that triggers when the SSE onerror fires while the run is still `running`. Display "Connection lost" indicator. Fall back to polling via the `useMultiAgentRun` refetchInterval (AC-23).

**AgentColumnCard.tsx**: One column per agent. Header shows agent name, provider/model, status indicator. Body shows verdict badge, score, summary, duration, tokens, cost, findings count. Findings listed below with severity badge and title. For failed runs, shows error message with red styling.

**ConflictsSection.tsx**:
- Receives `conflicts: Conflict[]` from the parent.
- "Show only conflicts" toggle (checkbox with accessible label -- AC-14). When toggled on, filters out groups where all `ConflictTake` entries have the same verdict.
- Each conflict row shows file:line, title, and a row of agent takes with severity badges or "ignored" indicators.
- Hidden when `conflicts.length === 0` or only 1 agent.

**constants.ts**: `POLL_INTERVAL_MS = 4000`, `SKELETON_COLUMNS = 3`.

**helpers.ts**: `isRunComplete(columns)`, `allRunsFailed(columns)`, `computeElapsed(ranAt)`.
**Skills:** `react-best-practices`, `react-frontend-best-practices`, `next-best-practices`, `typescript-expert`
**Tests:**
- `client/src/app/multi-agent-review/[id]/_components/ResultsView/ResultsView.test.tsx` -- test rendering with completed runs (verify columns render), test with in-progress runs (verify spinner), test conflict section visibility.
- `client/src/app/multi-agent-review/[id]/_components/ConflictsSection/ConflictsSection.test.tsx` -- test "Show only conflicts" toggle filtering.
**Depends on:** Step 6
**Addresses:** AC-10, AC-11, AC-12, AC-14, AC-15, AC-21, AC-22, AC-23

### Step 9: Add sidebar nav item for Multi-Agent Review

**Package:** client
**Files:**
- `client/src/components/app-shell/patch-nav.ts` (modify)
**What:** Add a new nav item to the SKILLS LAB section (or a new section) following the existing pattern for the Eval Dashboard:

```ts
const MULTI_AGENT_ITEM = {
  key: "multi-agent-review",
  label: "Multi-Agent Review",
  icon: "Users" as const,  // or "Layers" -- must exist in vendor/ui/icons.tsx
  href: "/multi-agent-review/configure",
  gKey: "m",
};
```

Append to the SKILLS LAB section with a guard against double-insertion. Verify the chosen icon name exists in `client/src/vendor/ui/icons.tsx` (per INSIGHTS.md: unregistered icon names cause silent void render).
**Skills:** `react-frontend-best-practices`
**Tests:** Verify sidebar renders the new item visually (manual check or extend AppShell test if one exists).
**Depends on:** none
**Addresses:** AC-1

### Step 10: End-to-end integration verification

**Package:** server
**Files:**
- `server/src/modules/multi-agent-review/routes.it.test.ts` (create)
**What:** Integration test using Fastify `inject()`:
1. Create a workspace, repo, PR, and 2 agents via seed helpers.
2. POST `/pulls/:prId/multi-agent-run` with both agent IDs. Assert 200, response has `id` and `runs[]`.
3. GET `/pulls/:prId/multi-agent-run/:id`. Assert 200, response has `columns[]`, `conflicts[]`.
4. POST with empty `agent_ids` array. Assert 422 (Zod validation) or 400.
5. POST with non-existent agent ID. Assert 404.
6. GET with non-existent multi-agent run ID. Assert 404.
7. Verify `agent_runs` rows have `multi_agent_run_id` set.
**Skills:** `fastify-best-practices`, `drizzle-orm-patterns`
**Tests:** This IS the test step.
**Depends on:** Step 4
**Addresses:** AC-2, AC-3, AC-8, AC-18, AC-19, AC-20, AC-24

## Proactive Skills That Will Fire

- `engineering-insight` -- will fire (10+ files changed across both packages)
- `breaking-change` -- will NOT fire (no existing routes/contracts are modified; only additive changes)
- `response-schema` -- will NOT fire (new endpoints only; existing response shapes unchanged)
- `deprecation-policy` -- will NOT fire (no public APIs removed)

## Risk Assessment

1. **Risk: `createAgentRun` signature change breaks existing callers.**
   Mitigation: The `multiAgentRunId` parameter is optional with default `undefined`. The existing `ReviewService.runReview` call does not pass it, so it gets NULL. Verify all callers via grep before modifying.

2. **Risk: Missing index on `agent_runs.multi_agent_run_id` degrades GET performance.**
   Mitigation: Explicitly verify the Drizzle-generated migration includes a B-tree index. If not, add `CREATE INDEX idx_agent_runs_multi_agent_run_id ON agent_runs (multi_agent_run_id)` to the migration SQL manually.

3. **Risk: Conflict computation is O(n^2) on findings count.**
   Mitigation: For typical multi-agent runs (3-5 agents, 10-50 findings each), this is <2500 comparisons -- negligible. Add a guard: if total findings exceed 500, skip conflict computation and return an empty array with a warning.

4. **Risk: `vendor/shared` copy divergence between server and client.**
   Mitigation: The new `multi-agent-api.ts` contract must be copied to `client/src/vendor/shared/contracts/` and its barrel export added to `client/src/vendor/shared/index.ts`. Per INSIGHTS.md, this is a physical copy. Mark this as a verification step.

5. **Risk: SSE connection drop not handled gracefully.**
   Mitigation: The existing `useRunEvents` hook closes the EventSource on error and decrements the `open` counter. The results page adds a per-column `connectionLost` flag that renders the indicator and triggers the polling fallback via `useMultiAgentRun`'s `refetchInterval`.

6. **Risk: Race condition between multi-agent run creation and agent execution.**
   Mitigation: The existing pattern (create `agent_runs` rows first, then fire-and-forget `executeRuns`) is already race-free because the SSE subscription targets the `runId` which exists before execution starts. The multi-agent run follows the same pattern.

7. **Risk: Agent name unavailable for deleted agents in results. (RESOLVED)**
   Resolution: `agent_name TEXT NOT NULL` column added to `agent_runs` in Step 1. Populated at run creation time via the extended `createAgentRun(agentName)` call. `getRunsForMultiAgent` reads `agent_runs.agent_name` directly -- no LEFT JOIN with `agents` needed. Name is preserved regardless of agent deletion, satisfying spec edge case 5: "agent name from the `agent_runs` record."

## Out of Scope

- **Automatic conflict resolution** -- spec explicitly excludes this (non-goal 1).
- **Finding accept/dismiss from multi-agent results page** -- spec defers to existing PR detail page (out of scope 2).
- **Re-running a subset of agents** -- spec defers to future enhancement (out of scope 3).
- **Multi-agent run history/list page** -- spec defers to future enhancement (out of scope 4).
- **Cross-PR multi-agent comparison** -- spec explicitly excludes (out of scope 5).
- **Changes to `agent-runner/` or `ci/`** -- spec explicitly excludes (non-goal 5).
- **Agent weighting or voting** -- spec explicitly excludes (non-goal 2).
