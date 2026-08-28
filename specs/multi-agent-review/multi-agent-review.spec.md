# Spec: Multi-Agent Review

Spec ID: MultiAgentReview_1
Status: draft
Supersedes: ---

## Problem and User

A DevDigest power user who has configured multiple review agents (e.g. a security-focused agent, a performance-focused agent, and a general code-quality agent) currently has no way to run all of them against a single PR in a coordinated manner and compare their outputs side by side. The existing review flow (`POST /pulls/:id/review` with `{all: true}`) runs agents but presents results as independent, sequential entries in the PR detail page. The user must mentally cross-reference findings across agents, cannot see where agents agree or disagree, and has no pre-run cost/time estimate.

This feature gives the user a dedicated "Multi-Agent Review" experience: a configuration page to pick a PR and select agents, a pre-run estimate of cost and duration, parallel execution with live per-agent progress, and a results page with side-by-side comparison including a "Where Agents Disagree" conflict view.

## Goals / Non-goals

### Goals
- Let users launch a coordinated multi-agent review against any PR from any tracked repo.
- Show a pre-run estimate of aggregate cost and wall-clock duration based on historical agent run data.
- Execute selected agents in parallel, streaming live per-agent progress via SSE.
- Present results in a side-by-side column layout with per-agent findings, scores, and verdicts.
- Surface inter-agent disagreements in a dedicated "Where Agents Disagree" section grouped by file+line region.
- Persist multi-agent runs as a first-class entity (`multi_agent_runs` table) with a 1:N FK from `agent_runs`.
- Add a top-level nav item for the feature.

### Non-goals
- **Consensus/merge logic** -- the system will NOT automatically reconcile or merge findings from multiple agents into a single verdict. The user interprets disagreements manually.
- **Agent weighting or voting** -- no weighted-average scoring across agents. Each agent's score and verdict stand independently.
- **CI integration** -- multi-agent runs are local-only; the existing CI single-agent flow is untouched.
- **Editing `vendor/shared/`** -- new Zod contracts will be added as new files; existing contracts will not be modified.
- **Changes to `agent-runner/` or `ci/`** -- explicitly out of scope per user confirmation.

## User stories

- As a reviewer with multiple agents, I want to run them all against a PR in one action, so that I get a comprehensive multi-perspective review without triggering each agent manually.
- As a reviewer, I want to see a cost and duration estimate before launching a multi-agent run, so that I can make an informed decision about resource usage.
- As a reviewer, I want to see live progress for each agent in parallel while the run is executing, so that I know which agents are still working and how long each has taken.
- As a reviewer, I want to compare agent findings side by side in columns, so that I can quickly see where they agree and where they differ.
- As a reviewer, I want a "Where Agents Disagree" section that highlights conflicting findings on the same code region, so that I can focus my attention on the most contentious areas.
- As a reviewer, I want to filter the disagreements view to show only conflicts (hiding unanimous groups), so that I can reduce noise when agents mostly agree.

## Acceptance criteria (EARS)

### Ubiquitous (always true, no trigger)

- The system shall include a "Multi-Agent Review" item in the application sidebar navigation, in a position consistent with existing top-level features.
- The system shall persist every multi-agent run as a row in `multi_agent_runs` with a workspace-scoped `id`, `workspace_id`, `pr_id`, and `ran_at` timestamp.
- The system shall link each constituent `agent_runs` row to its parent multi-agent run via a nullable `multi_agent_run_id` foreign key column on `agent_runs`.
- The system shall leave existing single-agent and "run all" review flows (`POST /pulls/:id/review`) completely unchanged; `multi_agent_run_id` is NULL for runs created through those flows.

### Event-Driven (triggered by an event)

- When the user navigates to `/multi-agent-review/configure`, the system shall display a configuration page containing: (a) a PR picker populated from `GET /repos/:repoId/pulls` using the active repo from `RepoProvider`, (b) a list of all agents with checkboxes (enabled agents checked by default, disabled agents unchecked), and (c) a pre-run estimate panel.
- When the user selects a PR and one or more agents on the configure page, the system shall display a pre-run estimate computed as: aggregate cost = sum of each selected agent's most recent `cost_usd` from any completed `agent_run` in the workspace; aggregate duration = maximum of each selected agent's most recent `duration_ms` (since agents run in parallel).
- When the user clicks the "Run" button on the configure page, the system shall send `POST /pulls/:prId/multi-agent-run` with the list of selected agent IDs.
- When the server receives `POST /pulls/:prId/multi-agent-run`, the system shall: (a) create one `multi_agent_runs` row, (b) create one `agent_runs` row per selected agent with `multi_agent_run_id` set to the new multi-agent run ID, (c) execute each agent review in parallel using `ReviewRunExecutor`, and (d) return a response containing the multi-agent run ID and an array of `{run_id, agent_id, agent_name}` targets.
- When the multi-agent run is created successfully, the system shall redirect the client to `/multi-agent-review/[id]` where `[id]` is the multi-agent run ID.
- When the user navigates to `/multi-agent-review/[id]`, the system shall fetch the multi-agent run record and its associated agent runs, then render the results page.
- When agent runs are still in progress on the results page, the system shall subscribe each agent's column to its SSE stream via `useRunEvents`, displaying a spinner and elapsed time in the column header.
- When all agent runs complete, the system shall display final stats (duration, tokens, cost, findings count, score) in each column header.
- When the results page loads with completed runs, the system shall compute the "Where Agents Disagree" section server-side by grouping findings across agents by file and overlapping line ranges, identifying groups where agents produced different severities, categories, or where only a subset of agents flagged the region.
- When the user toggles "Show only conflicts" on the results page, the system shall hide all groups in the "Where Agents Disagree" section where every agent produced identical findings (same severity, same category), showing only groups with actual disagreement.

### State-Driven (true while a condition holds)

- While any agent in a multi-agent run has status `running`, the results page shall poll `GET /pulls/:prId/multi-agent-run/:id` (or the constituent runs endpoint) at a 4-second interval to refresh status.
- While the configure page is displayed, the system shall reflect the active repo from `RepoProvider` for PR selection; if the user switches repos via the global repo picker, the PR list shall refresh accordingly.

### Optional Feature (conditional on feature presence)

- Where an agent has no historical run data in the workspace (no completed `agent_run` row exists for that agent), the pre-run estimate panel shall display "?" for that agent's cost and duration contribution, and the aggregate estimate shall annotate that it is partial.

### Unwanted Behavior (error/fault handling)

- If `POST /pulls/:prId/multi-agent-run` is called with zero agent IDs, then the system shall return HTTP 400 with error code `invalid_run_request` and message "At least one agent must be selected."
- If `POST /pulls/:prId/multi-agent-run` is called with an agent ID that does not exist or belongs to a different workspace, then the system shall return HTTP 404 with error code `agent_not_found`.
- If the PR ID in the URL does not exist or does not belong to the workspace, then the system shall return HTTP 404 with error code `pull_not_found`.
- If one agent in a multi-agent run fails (LLM error, timeout, quota) while others succeed, then the system shall mark only the failed agent's `agent_runs` row as `status='failed'` with the error message, display the failure in that agent's column on the results page, and allow the user to view the successful agents' results normally.
- If all agents in a multi-agent run fail, then the results page shall display a full-run error state with each agent's individual error message.
- If the SSE connection for an agent's run drops, then the client shall display a "Connection lost" indicator in that agent's column header and fall back to polling the run status endpoint.
- If `GET /pulls/:prId/multi-agent-run/:id` is called with a non-existent multi-agent run ID, then the system shall return HTTP 404.

### Out of scope

- **Automatic conflict resolution** -- the system surfaces disagreements but does not attempt to reconcile them. This is an intentional design choice; the user is the arbiter.
- **Finding accept/dismiss from the multi-agent results page** -- findings can be acted on from the existing PR detail page. Adding inline actions to the comparison view is deferred to a later iteration.
- **Re-running a subset of agents from a completed multi-agent run** -- the user must create a new multi-agent run. Partial re-run is a future enhancement.
- **Multi-agent run history/list page** -- there is no dedicated page listing past multi-agent runs. The user accesses them via the configure page or direct URL. A history page is a future enhancement.
- **Cross-PR multi-agent comparison** -- comparing multi-agent results across different PRs is not in scope.

## Edge cases

| # | Scenario | Expected behavior |
|---|----------|-------------------|
| 1 | User selects only one agent on the configure page | The run proceeds normally with a single agent. The results page shows one column. The "Where Agents Disagree" section is hidden (no comparison possible). |
| 2 | User selects agents that use different providers (e.g. one OpenAI, one Anthropic) | Each agent runs with its own configured provider/model. The pre-run estimate uses each agent's individual historical data. No cross-provider normalization. |
| 3 | Selected PR has zero diff (no changed files) | Each agent receives an empty diff. Behavior matches existing single-agent review behavior (agents may produce zero findings or a short summary). |
| 4 | Two agents produce findings on the same file but non-overlapping line ranges | These are NOT treated as disagreements. Each finding appears only in its respective agent's column. The "Where Agents Disagree" section does not group them. |
| 5 | An agent is deleted after being included in a completed multi-agent run | The `agent_runs.agent_id` FK is `SET NULL` on delete. The results page shows the run data with agent name from the `agent_runs` record (or "Deleted agent" fallback). The column remains visible with historical data. |
| 6 | User navigates to `/multi-agent-review/[id]` for a run that is still in progress | The results page renders with live SSE streams. Columns for incomplete agents show spinners. Columns for completed agents show final results. The "Where Agents Disagree" section updates as agents complete. |
| 7 | The workspace has no completed agent runs for any agent (fresh workspace) | All agents show "?" for estimates. The aggregate estimate displays "No historical data available" with a note that estimates will improve after the first run. |
| 8 | User refreshes the results page mid-run | The page reloads, re-fetches the multi-agent run record and constituent run statuses from the DB. For runs still in progress, SSE streams are re-established (RunBus replay buffer provides event history). For completed runs, final results are shown from DB. |
| 9 | Concurrent multi-agent runs on the same PR | Both runs proceed independently. Each creates its own `multi_agent_runs` row and separate `agent_runs` rows. Results pages are isolated by multi-agent run ID. |
| 10 | Network interruption during SSE streaming on results page | The affected agent column shows a "Connection lost" indicator. The page falls back to polling the run status endpoint at 4-second intervals. When the run completes, final results are fetched from the DB. |

## Non-functional requirements

- **Performance**: The pre-run estimate query (most recent completed run per agent) should use an indexed lookup and complete in under 100ms for workspaces with up to 10,000 agent runs. Agent runs execute in parallel (not sequentially); wall-clock time is bounded by the slowest agent.
- **Security**: The `POST /pulls/:prId/multi-agent-run` endpoint must call `getContext(container, req)` to resolve and enforce workspace scoping. Agent IDs in the request body must be validated as belonging to the caller's workspace. No cross-workspace data leakage.
- **Accessibility**: The configure page checkboxes and PR picker must be keyboard-navigable. The results page columns should use semantic headings for screen readers. The "Show only conflicts" toggle must have an accessible label and be operable via keyboard.

## Inputs and provenance

| Input | Source | Format |
|-------|--------|--------|
| PR list for picker | `GET /repos/:repoId/pulls` (existing endpoint) | `PrMetaFindings[]` |
| Agent list | `GET /agents` (existing endpoint) | `Agent[]` |
| Historical run stats (for estimates) | `agent_runs` table, most recent completed row per agent in the workspace | `{ cost_usd, duration_ms }` per agent |
| Selected agent IDs | User selection on configure page | `string[]` (UUIDs) |
| Selected PR ID | User selection on configure page | `string` (UUID) |
| Multi-agent run record | `GET /pulls/:prId/multi-agent-run/:id` (new endpoint) | Multi-agent run row + associated agent runs |
| Per-agent SSE events | `GET /runs/:runId/events` (existing endpoint) | `RunEvent` stream |
| Per-agent reviews + findings | `GET /pulls/:prId/reviews` (existing endpoint) | `ReviewRecord[]` |
| Conflict groups | Server-side computation from findings across agent runs in a multi-agent run | Grouped by file + overlapping line range |

## Untrusted inputs

| Input | Risk | Validation |
|-------|------|------------|
| Agent IDs in `POST /pulls/:prId/multi-agent-run` body | User could submit IDs for agents in another workspace, or non-existent IDs | Validate each agent ID exists and belongs to the resolved workspace. Return 404 for missing/foreign agents. Reject empty arrays with 400. |
| PR ID in URL path (`/pulls/:prId/multi-agent-run`) | User could submit a PR ID from another workspace | Validate PR belongs to the resolved workspace via `getContext`. Return 404 if not found. |
| Multi-agent run ID in URL path (`/multi-agent-review/[id]`) | User could guess IDs for runs in another workspace | Validate that the multi-agent run belongs to the resolved workspace. Return 404 if not found or not owned. |
| SSE `runId` subscriptions from client | Client could subscribe to run events for runs belonging to another workspace | The existing `GET /runs/:id/events` endpoint calls `getContext` for workspace validation. No change needed. |

## Open questions

- [ ] **Disagreement grouping algorithm**: What constitutes "overlapping line ranges" for conflict detection? Exact line overlap, or should findings within N lines of each other on the same file be grouped? The server-side computation needs a concrete proximity threshold. Suggest starting with exact line-range overlap (any intersection of `[start_line, end_line]` intervals) and iterating based on user feedback.
- [ ] **Results page layout for many agents**: If the user selects 5+ agents, horizontal columns may overflow the viewport. Should the results page switch to a tabbed layout beyond a threshold (e.g. 4 agents), or always use scrollable columns? Suggest scrollable columns with a sticky first column (file/line reference) for initial implementation.
- [ ] **Pre-run estimate granularity**: Should the estimate break down cost per-agent in the UI, or only show the aggregate sum? User confirmed sum of costs and max of durations, but did not specify per-agent breakdown visibility. Suggest showing both aggregate and per-agent breakdown.
- [ ] **Multi-agent run status field**: The existing `multi_agent_runs` table has only `id`, `workspace_id`, `pr_id`, and `ran_at`. Should a `status` column be added (e.g. `running`, `completed`, `failed`) that is derived from constituent agent run statuses, or should status always be computed on read? Suggest computed-on-read to avoid synchronization complexity.
- [ ] **Relationship to existing "Run All" flow**: The existing `POST /pulls/:id/review {all: true}` runs all enabled agents but does NOT create a `multi_agent_runs` row. Should the "Run All" button on the PR detail page be updated to also create a multi-agent run, or should the two flows remain completely independent? User confirmed keeping them separate, but this may cause confusion if both exist in the UI.
