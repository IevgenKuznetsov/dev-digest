# Spec: Export to CI v2 (Delta)

Spec ID: ExportToCi_2
Status: draft
Supersedes: —

> **Delta-only spec.** This document specifies ONLY the three v2 changes below.
> The authoritative baseline for all unchanged behavior is **`ExportToCi_1`**
> (`specs/export-to-ci/export-to-ci.spec.md`). Everything in `ExportToCi_1` —
> the `ci` module, the 4-step Export Wizard (Target → Preview → Configure →
> Install), the `POST /agents/:id/export-ci` endpoint, workflow generation, the
> `POST /ci/ingest` endpoint, `GET /ci/runs`, `GET /ci/installations`, the agent
> CI tab, and the CI Runs page — remains in force and is NOT re-specified here.
> `Supersedes` is `—` because this spec extends, rather than replaces,
> `ExportToCi_1`; the two are read together (v1 = baseline, v2 = delta).
>
> Where a v2 acceptance criterion refers to unchanged v1 behavior, it cites the
> v1 criterion (e.g. "per AC-UN5 of ExportToCi_1") instead of restating it.

## Problem and User

The user persona is unchanged from `ExportToCi_1`: the **agent author** who tunes
review agents in the DevDigest studio and installs them into a repo's CI.

`ExportToCi_1` shipped export, workflow generation, and the server-side ingest
endpoint, but left three gaps that this delta closes:

1. **No operational visibility across agents.** v1 gives a per-run CI Runs table
   and a per-agent CI tab, but no aggregate view of how agents perform over time
   (total runs, total cost, average duration, accept rate, cost breakdown by
   agent/model). Authors cannot answer "which agents earn their keep." The new
   **Agent Performance dashboard** (`docs/AgentCI/design1.png`) fills this gap by
   aggregating the existing `agent_runs` observability rows (local **and**
   `source='ci'`).

2. **No first-class multi-repo view.** v1's `ci_installations` table is already
   keyed per repo, so one agent can technically be installed into many repos —
   but the CI tab does not present this, and there is no "Add repository" flow.
   `docs/AgentCI/design5.png` shows an agent "Active in 2 repos" with per-repo
   target type, last status, and an **Add repository** action. This delta makes
   multi-repo installation a first-class, visible workflow.

3. **Ingest round-trip was deferred.** `ExportToCi_1` explicitly deferred the live
   end-to-end round-trip from GitHub-hosted runners to the local-first studio
   (see its Non-goals and Open Questions: the ingest `curl` step is generated as a
   *commented-out* block, and `CI_INGEST_TOKEN` / studio URL are never provisioned
   into the target repo). v2 **solves reachability**: it activates the ingest call,
   provisions `CI_INGEST_TOKEN` and a configurable `DEVDIGEST_STUDIO_URL` into the
   target repo, and makes the CI Runs page populate from real CI executions —
   carrying forward every v1 security requirement intact.

## Goals / Non-goals

### Goals

- **Agent Performance dashboard.** Add a new client page (`/agent-performance`,
  under the GLOBAL nav group, distinct from CI Runs and Eval Dashboard) and a new
  read route `GET /ci/performance` in the existing `ci` module. It aggregates
  `agent_runs` (local + `source='ci'`) over a selectable time window (default 30
  days) into: TOTAL RUNS, TOTAL COST (with delta vs the previous equal window),
  AVG ACCEPT RATE (gauge), MOST-ACTIVE AGENT, a per-agent table (runs, avg cost,
  avg duration, accept rate + trend arrow, last run, View link), and a COST
  BREAKDOWN (by agent, by model).
- **Multi-repo installations.** Surface all `ci_installations` for an agent on the
  CI tab as a per-repo list (repo, target type, last status, last run time), add
  an **Add repository** action that re-enters the Export Wizard for an additional
  repo, and add a per-repo **Remove** action. Extend the read surface so each
  installation carries `last_status` and `last_run_at`.
- **Live CI→studio ingest round-trip (self-hosted runner).** Activate the
  workflow's `POST /ci/ingest` call (no longer commented out) and make the
  local-first studio reachable **exclusively via a GitHub self-hosted Actions
  runner** on the operator's network — no public tunnel or hosted relay. The
  generated workflow's `runs-on:` targets a configurable self-hosted runner label;
  the bundled `agent-runner` step runs there unchanged; the ingest step reaches
  `DEVDIGEST_STUDIO_URL` (default the local studio, e.g. `http://localhost:3001`)
  over the private network, so the studio is never internet-exposed. Read the token
  from the `CI_INGEST_TOKEN` repo secret and the URL from a repo `DEVDIGEST_STUDIO_URL`
  variable; Install provisions both into the target repo via the GitHub API (Actions
  secret + variable). Preserve all v1 security invariants for the newly-wired call.
- **Extend, never edit, shared contracts.** Add new Zod contracts in a **new file**
  under `server/src/vendor/shared/contracts/` (e.g. `ci-v2.ts`) for the dashboard
  aggregate and the extended installation shape; the barrel re-exports it. Existing
  `eval-ci.ts` contracts are reused unchanged (extend-only rule).
- **Additive schema only.** Any new column is added by a new Drizzle migration; no
  existing column is altered. (See Open Questions on whether new columns are needed
  at all vs. deriving values by join.)

### Non-goals

- **CircleCI / Jenkins / Generic CLI generators.** Still GHA-only. Those Target
  cards remain disabled (per AC-ST1 of `ExportToCi_1`). Note: `design3.png` shows a
  "CircleCI" row in the CI Runs source column and an "All sources" filter — this is
  a display/filter affordance over ingested `source` strings, NOT a new generator.
- **reviewer-core, the injection guard, and the grounding gate.** Untouched
  (unchanged from `ExportToCi_1`).
- **Editing `eval-ci.ts` or any existing shared contract / schema column.**
  Extend-only; new files and new nullable columns via migration only.
- **The multi-run service and the PR feed.** Untouched (unchanged from
  `ExportToCi_1`).
- **The Eval Dashboard (`EvalPipeline_1`).** Agent Performance is **separate and
  complementary**: Eval Dashboard reports recall/precision/citation-accuracy from
  `eval_runs`; Agent Performance reports operational runs/cost/duration/accept-rate
  from `agent_runs`. This delta neither modifies nor supersedes `EvalPipeline_1`;
  both appear in the nav (as `design1.png` shows). See Open Questions.
- **Public tunnels and hosted ingest relays.** v2 deliberately does NOT support
  exposing the local-first studio to the public internet via a tunnel (ngrok,
  cloudflared, …) or a hosted relay. Reachability is provided **only** by a GitHub
  self-hosted Actions runner co-located with (or network-adjacent to) the studio.
  Operating/registering that self-hosted runner is the operator's responsibility;
  v2 does not install or manage it.
- **Public-repo self-hosted CI.** Self-hosted runners executing untrusted PR code
  are unsafe on public repos (GitHub's own guidance). v2 targets **private repos**;
  the v1 fork guard (skip the job when `head.repo.fork`, AC-UN5 of `ExportToCi_1`)
  stays strictly enforced and is not relaxed.
- **Secret rotation / management UI** for `CI_INGEST_TOKEN` (unchanged from v1).
- **Retention/cleanup of `ci_runs` / `agent_runs`** (unchanged; unbounded — see v1
  Open Questions).
- **Per-finding accept/dismiss state for CI runs.** CI runs persist only
  `findings_count`; individual `findings` rows (which carry `accepted_at` /
  `dismissed_at`) are produced by the local review flow. The dashboard's accept
  rate is therefore derived from local review findings only (see AC-U3 and Open
  Questions). Ingesting per-finding accept state from CI is out of scope.

## User stories

- As an agent author, I want an **Agent Performance** page that aggregates total
  runs, total cost (with delta), average accept rate, most-active agent, a
  per-agent breakdown, and cost-by-agent/by-model donuts over a selectable window,
  so that I can decide which agents are worth keeping and where cost concentrates.
- As an agent author, I want to change the dashboard's **time window** (e.g. 7 / 30
  / 90 days), so that I can see recent vs longer-term trends.
- As an agent author, I want my agent's **CI tab** to list every repo the agent is
  installed in, each with its target type and last CI status/time, so that I can
  manage a multi-repo deployment from one place (design5).
- As an agent author, I want an **Add repository** button on the CI tab that
  re-opens the Export Wizard for another repo, so that I can install the same tuned
  agent into additional repos without leaving the page.
- As an agent author, I want to **remove** a repo from an agent's CI deployment, so
  that I can decommission an installation I no longer want tracked.
- As an agent author, I want the exported workflow to **actually POST results back**
  to my studio through an authenticated, configurable endpoint, so that the CI Runs
  page and dashboard populate from real CI executions.
- As a security-conscious author, I want the newly-activated ingest call to keep
  every v1 protection (token via SecretsProvider, least-privilege permissions, no
  secrets in artifacts/logs, fork-PR guard), so that turning on the round-trip does
  not widen my attack surface.

## Acceptance criteria (EARS)

Design decisions resolved for this delta (interactive Q&A tool unavailable in this
environment; following the `ExportToCi_1` precedent, simplest-viable choices were
adopted from the design docs, the decided v2 scope, and the existing codebase, and
are recorded here; unresolved items are in Open Questions):

- **Dashboard data source** — all `agent_runs` rows (local + `source='ci'`),
  matching design1's "TOTAL RUNS (30D) = 253" (larger than CI-only would be).
- **Accept rate** — derived from local review `findings` (`accepted_at` vs
  `dismissed_at`) grouped by agent, because CI runs carry no per-finding accept
  state (only `findings_count`). CI runs still contribute to run counts, cost, and
  duration.
- **Time window** — default 30 days; selectable among a fixed allow-list
  `{7, 30, 90}` days. The delta metric compares the window to the immediately
  preceding equal-length window.
- **Placement** — new page `/agent-performance` (GLOBAL nav), new route
  `GET /ci/performance` in the existing `ci` module.
- **Multi-repo** — no new table (v1 `ci_installations` is already per-repo); the
  CI tab lists all installations for the agent; `last_status` / `last_run_at` come
  from the latest joined `ci_runs` row per installation.
- **Live ingest** — reachability is **self-hosted runner only** (no tunnel/relay).
  The generated workflow sets `runs-on:` to a configurable self-hosted runner label,
  reads `DEVDIGEST_STUDIO_URL` (repo variable, default the local studio) and
  `${{ secrets.CI_INGEST_TOKEN }}` (repo secret); Install provisions both via the
  GitHub API; the ingest `curl` step is emitted active (uncommented). Targeted at
  private repos; v1 fork guard stays enforced.
- **Ingest failure mode** — the runtime ingest POST is **best-effort**: a failed or
  unreachable studio never fails the CI review job (studio uptime is not a merge
  gate); the artifact is still uploaded.
- **Remove semantics** — Remove deletes only the `ci_installations` row (historical
  `ci_runs` preserved via `ON DELETE SET NULL`); it does **not** close any open
  `devdigest/ci` PR in the target repo (the author closes that in GitHub).
- **Route ownership** — `GET /ci/performance` lives in the existing `ci` module; its
  read-only cross-module join to `findings`/`reviews` is acceptable.
- **Accept rate** — derived from local review `findings` only; CI-only agents render
  "—" (never `0%`). Ingesting per-finding CI accept state is deferred (needs a new
  artifact field + schema, beyond this delta).
- **Trend/delta basis** — the selected window is compared to the immediately
  preceding equal-length window.
- **Denormalization** — `last_status` / `last_run_at` and all dashboard aggregates
  are derived by join at read time; no new columns, no migration.
- **Nav grouping** — Agent Performance and the Eval Dashboard remain separate pages,
  both in the nav (per design1); they are not merged.

### Ubiquitous (always true, no trigger)

- AC-U1: The system shall expose `GET /ci/performance` in the existing `ci` module
  (`server/src/modules/ci/routes.ts`), scoped to the current workspace via
  `getContext(container, req)` before any work (consistent with all non-ingest `ci`
  routes; ingest remains token-authed per AC-U2 of `ExportToCi_1`).
- AC-U2: The system shall compute Agent Performance aggregates from `agent_runs`
  rows in the current workspace whose `ran_at` falls within the selected window,
  counting both `source='local'` and `source='ci'` rows.
- AC-U3: The system shall compute per-agent accept rate as
  `accepted / (accepted + dismissed)` over that agent's local review `findings`
  (`findings.accepted_at IS NOT NULL` vs `findings.dismissed_at IS NOT NULL`) within
  the window; when an agent has no accepted-or-dismissed findings, its accept rate
  shall be reported as `null` (rendered as "—"), never as `0%`.
- AC-U4: The system shall define the dashboard response as a **new** Zod contract in
  a new shared file (e.g. `server/src/vendor/shared/contracts/ci-v2.ts`), exported
  via the barrel; it shall not modify `eval-ci.ts` or any existing contract.
- AC-U5: The system shall extend the CI-tab installation read shape with
  `last_status: string | null` and `last_run_at: string | null` via a **new**
  contract (not by editing `CiInstallation` in `eval-ci.ts`); the extended shape
  reuses `CiInstallation` by composition.
- AC-U6: The generated workflow shall keep `permissions:` exactly `contents: read` +
  `pull-requests: write` with all others `none` (unchanged; per AC-U4 of
  `ExportToCi_1`) even after the ingest step is added.
- AC-U7: The system shall never write `OPENROUTER_API_KEY`, `CI_INGEST_TOKEN`, or
  `GITHUB_TOKEN` values into any manifest, workflow file, artifact, log line, or
  trace (unchanged; per AC-U5 of `ExportToCi_1`, extended to `CI_INGEST_TOKEN`).
- AC-U8: The system shall read `CI_INGEST_TOKEN` on the server only through
  `SecretsProvider` (`CI_INGEST_TOKEN_KEY`), never from the DB or request body
  (unchanged from `ExportToCi_1`).
- AC-U9: The generated workflow shall set `runs-on:` to a **self-hosted runner
  label** (a configurable value, default e.g. `[self-hosted, devdigest]`) rather than
  a GitHub-hosted runner, so the review + ingest steps execute on the operator's
  network with reachability to the local-first studio. The workflow shall NOT contain
  any public tunnel or hosted-relay configuration.

### Event-Driven (triggered by an event)

- AC-E1: When the Agent Performance page loads (or its window selector changes), the
  system shall call `GET /ci/performance?window=<7|30|90>` and render TOTAL RUNS,
  TOTAL COST with a signed delta vs the previous equal window, AVG ACCEPT RATE
  (gauge), MOST-ACTIVE AGENT, the per-agent table, and the By-agent / By-model cost
  donuts.
- AC-E2: When the author clicks **View** on a per-agent row, the system shall
  navigate to that agent's page (the CI tab, so the author can drill into that
  agent's installations and runs).
- AC-E3: When the agent CI tab loads, the system shall call `GET /ci/installations`
  scoped to that agent and render one row per repo with repo, target type,
  `last_status`, and `last_run_at` (design5), plus the "Active in N repos" summary.
- AC-E4: When the author clicks **Add repository** on the CI tab, the system shall
  open the Export Wizard (per `ExportToCi_1`) pre-scoped to add an installation for
  a new repo, reusing the entire v1 wizard flow (Target → Preview → Configure →
  Install).
- AC-E4b: When the author is in the Configure step, the system shall collect the
  **self-hosted runner label** (default e.g. `[self-hosted, devdigest]`) and the
  **studio URL** (default `http://localhost:3001`), and carry them into the generated
  workflow's `runs-on:` (AC-U9) and the `DEVDIGEST_STUDIO_URL` provisioning (AC-E6).
- AC-E5: When the author confirms **Remove** on a per-repo installation, the system
  shall delete that `ci_installations` row (its `ci_runs` are `ON DELETE SET NULL`
  per existing schema, so historical run rows are preserved) and refresh the tab.
- AC-E6: When the author completes Install (action `open_pr`) with live ingest
  wiring enabled, the system shall, in addition to committing files and opening the
  PR (per AC-E4 of `ExportToCi_1`), provision the target repo with the
  `CI_INGEST_TOKEN` **Actions secret** and the `DEVDIGEST_STUDIO_URL` **Actions
  variable** via the GitHub API.
- AC-E7: When the workflow's review job finishes on the self-hosted runner, it shall
  (in an `if: always()` step) POST `devdigest-result.json` to
  `${DEVDIGEST_STUDIO_URL}/ci/ingest` with an
  `Authorization: Bearer ${{ secrets.CI_INGEST_TOKEN }}` header, reaching the local
  studio over the operator's private network, so that a valid ingest populates
  `agent_runs` (`source='ci'`) + `ci_runs` per AC-E6 of `ExportToCi_1`.
- AC-E8: When a live-ingested run arrives and is accepted, the system shall make it
  appear on the CI Runs page (auto-refresh, per AC-E7 of `ExportToCi_1`) and count
  toward the Agent Performance dashboard on its next load.

### State-Driven (true while a condition holds)

- AC-ST1: While the Agent Performance page has no `agent_runs` in the selected
  window, the system shall render an explicit empty state (zeroed cards, "no runs
  in this window") rather than blank or error UI.
- AC-ST2: While `DEVDIGEST_STUDIO_URL` is unset or empty in the target repo, the
  workflow's ingest step shall no-op (skip the POST) without failing the job, so
  that a review still runs and uploads its artifact.
- AC-ST3: While an agent is installed in multiple repos, the CI tab shall show the
  "Active in N repos" count and a per-repo status list (design5), and **Update CI
  config** / **Remove** actions shall operate per repo, never across all repos at
  once.

### Optional Feature (conditional on feature presence)

- AC-O1: Where the target repo already has a `CI_INGEST_TOKEN` secret, Install shall
  overwrite it with the studio-issued value (idempotent provisioning), and where it
  does not, Install shall create it.
- AC-O2: Where `SecretsProvider` has no `CI_INGEST_TOKEN` configured on the studio
  side, the system shall surface a clear pre-flight error in the wizard Install step
  and shall not provision an empty/placeholder secret into the target repo.
- AC-O3: Where the selected dashboard window is not in the allow-list `{7, 30, 90}`,
  the system shall reject it (validation) and fall back to the 30-day default.

### Unwanted Behavior (error/fault handling)

- AC-UN1: If `GET /ci/performance` receives a `window` outside `{7, 30, 90}`, then
  the system shall return `400`/`422` (or coerce to the 30-day default) and shall
  not run an unbounded aggregate.
- AC-UN2: If provisioning the `CI_INGEST_TOKEN` secret or `DEVDIGEST_STUDIO_URL`
  variable into the target repo fails (missing scope, no admin rights, API error),
  then the system shall surface the error to the wizard and shall clearly report
  that the PR was opened but ingest wiring is incomplete; it shall not silently
  claim a working round-trip.
- AC-UN3: If a fork PR triggers the workflow, then the ingest step shall not run
  with secrets (the job-level fork guard from AC-UN5 of `ExportToCi_1` already skips
  the whole job); the round-trip shall never expose `CI_INGEST_TOKEN` to fork code.
- AC-UN4: If the live ingest POST fails at runtime (studio unreachable, non-2xx),
  then the workflow step shall not fail the review job (best-effort ingest) and the
  artifact shall still be uploaded, so CI status reflects the review, not the
  studio's reachability.
- AC-UN5: If a `POST /ci/ingest` request lacks a valid `CI_INGEST_TOKEN`, then the
  system shall reject with `401` and persist nothing (unchanged; per AC-UN1 of
  `ExportToCi_1`) — this delta only activates the caller, not a weaker check.
- AC-UN6: If an ingested artifact's repository / commit SHA does not match a known
  installation, then the system shall reject with `400`/`422` and persist nothing
  (unchanged; per AC-UN2 of `ExportToCi_1`).
- AC-UN7: If the author attempts **Add repository** for a repo the agent is already
  installed in, then the system shall treat it as an update of the existing
  installation (reuse the open `devdigest/ci` PR per AC-E9 of `ExportToCi_1`) rather
  than creating a duplicate `ci_installations` row for the same `(agent, repo)`.
- AC-UN8: If `GET /ci/performance` encounters an agent with runs but no
  accept/dismiss findings, then it shall report that agent's accept rate as `null`
  and shall not divide by zero.

### Out of scope

- **The workflow's review execution, gate, and grounding.** Owned by
  `agent-runner` / `reviewer-core`; unchanged (per `ExportToCi_1` Out of scope).
- **Eval recall/precision/citation metrics.** Owned by `EvalPipeline_1`'s Eval
  Dashboard; Agent Performance deliberately does not compute or display them.
- **Non-GHA workflow generation and non-GHA source ingestion.** GHA-only remains;
  the "All sources" filter merely displays whatever `source` string was ingested.
- **A dedicated per-finding CI accept/dismiss UI.** CI runs remain count-only.
- **Retention/cleanup and pagination limits** for the dashboard aggregate beyond
  the time-window bound (see Open Questions).

## Edge cases

| # | Scenario | Expected behavior |
|---|----------|-------------------|
| 1 | Workspace has zero runs in the selected window | Dashboard shows empty state with zeroed cards, no error (AC-ST1). |
| 2 | Agent has CI runs but no accept/dismiss findings | Accept rate `null` → rendered "—", not 0% (AC-U3, AC-UN8). |
| 3 | `window` query param is `45` (not allowed) | 400/422 or coerce to 30d default; no unbounded scan (AC-UN1, AC-O3). |
| 4 | TOTAL COST delta when previous window had zero cost | Delta shown as the full current cost (or "n/a"); never divide-by-zero. |
| 5 | Agent installed in 2 repos (design5) | CI tab shows "Active in 2 repos" + 2 per-repo rows with individual last status/time (AC-E3, AC-ST3). |
| 6 | Add repository for a repo already installed | Reuse existing installation/open PR; no duplicate row (AC-UN7). |
| 7 | Remove an installation that has historical `ci_runs` | Installation row deleted; `ci_runs.ci_installation_id` set null (existing FK); runs preserved (AC-E5). |
| 8 | Target repo missing `DEVDIGEST_STUDIO_URL` | Ingest step no-ops; review still runs and uploads artifact (AC-ST2). |
| 9 | Studio unreachable at ingest time | Ingest POST fails best-effort; job does not fail; artifact still uploaded (AC-UN4). |
| 10 | Fork PR to a repo with live ingest wired | Job (incl. ingest) skipped by fork guard; token never exposed (AC-UN3). |
| 11 | Provisioning secret fails (no admin scope) | Wizard reports PR opened but ingest wiring incomplete; no false success (AC-UN2). |
| 12 | Studio-side `CI_INGEST_TOKEN` not configured at Install | Pre-flight error; no empty secret provisioned (AC-O2). |
| 13 | Ingest replay (same installation, PR, SHA) after live wiring | Existing `ci_runs` row updated, not duplicated (unchanged; AC-UN6 of `ExportToCi_1`). |
| 14 | Malicious agent/model strings in ingested artifact shown on dashboard | Rendered as inert text (labels/legends), never interpolated into shell or markup; artifact validated by `CiResultArtifact` at ingest. |
| 15 | No self-hosted runner registered with the target repo | Workflow's `runs-on:` self-hosted label never matches; jobs stay queued and never execute. Wizard docs/Install note warns the runner must be registered before the round-trip works. |
| 16 | Author installs into a public repo | Self-hosted runner + untrusted PR code is unsafe; v2 targets private repos. Fork guard still skips fork PRs; the wizard surfaces a private-repo advisory (does not silently enable). |

## Non-functional requirements

- **Performance**: `GET /ci/performance` is a bounded aggregate over one
  time-windowed set of `agent_runs` rows (plus a findings join for accept rate);
  it must use SQL aggregation (GROUP BY agent), not per-row app-side loops, and be
  window-bounded to avoid full-table scans. Dashboard is load/refresh-driven, not
  polled aggressively. CI Runs auto-refresh interval is unchanged from
  `ExportToCi_1`.
- **Security** (carry forward the full `ExportToCi_1` model, extended to the
  live ingest wiring):
  - Least-privilege workflow `permissions:` unchanged — `contents: read` +
    `pull-requests: write`, all else `none` (AC-U6; AC-U4 of `ExportToCi_1`).
  - `CI_INGEST_TOKEN` is referenced in the workflow only as
    `${{ secrets.CI_INGEST_TOKEN }}`; its value is read on the studio side only via
    `SecretsProvider` and is never written to any manifest, workflow, artifact, log,
    or trace (AC-U7, AC-U8).
  - `DEVDIGEST_STUDIO_URL` is a repo **variable**, not a secret (it is not
    sensitive); the token is a repo **secret**.
  - **Self-hosted runner boundary.** Reachability comes only from a self-hosted GHA
    runner on the operator's private network; the studio is never internet-exposed
    (no tunnel/relay). Self-hosted runners run untrusted PR code, so v2 targets
    **private repos**, keeps the fork guard strictly enforced, and the token/URL
    never leave the private network. Operators should isolate the runner (dedicated
    host/ephemeral runner) per GitHub's self-hosted hardening guidance.
  - Fork PRs get no secrets and no ingest (fork guard unchanged; AC-UN3;
    AC-UN5 of `ExportToCi_1`). No `pull_request_target` + untrusted checkout.
  - Ingest remains token-authenticated with constant-time comparison, schema +
    repository + commit-SHA + installation-match validation, and dedupe — all
    unchanged from `ExportToCi_1` (AC-UN5, AC-UN6). The delta activates the caller;
    it does not relax any server check.
  - Runtime ingest is best-effort: a failed/unreachable studio must not fail the CI
    job (AC-UN4), preventing studio availability from becoming a merge gate.
  - Ingested `agent`/`model`/PR context strings are untrusted data; the dashboard
    renders them as inert labels and never executes or interpolates them.
  - External actions remain pinned to full commit SHAs (unchanged; AC-U6 of
    `ExportToCi_1`).
- **Accessibility**: The Agent Performance page uses accessible chart alternatives
  (table is the primary data source; donuts/gauge have text labels and values as in
  design1). Window selector and "View" links are keyboard-navigable. The multi-repo
  list and Add/Remove actions are keyboard-operable; Remove requires a confirm step.
- **Observability**: Live-ingested runs continue to be recorded in `agent_runs`
  (`source='ci'`) and `ci_runs` with provenance (`commit_sha`, `model`,
  `manifest_version`) per `ExportToCi_1`. Provisioning failures are logged
  server-side without secret values.

## Inputs and provenance

| Input | Source | Format |
|-------|--------|--------|
| Dashboard window | Agent Performance page → `GET /ci/performance?window=` | Enum `{7,30,90}` (days), default 30 |
| Run metrics (count, cost, duration) | `agent_runs` (local + `source='ci'`) in workspace, windowed | Aggregated SQL rows |
| Accept-rate inputs | `findings.accepted_at` / `findings.dismissed_at` joined via `reviews.agent_id` | Counts per agent |
| Cost-by-agent / by-model | `agent_runs.cost_usd` grouped by `agent_id` / `model` | Aggregated SQL rows |
| Multi-repo installations | `GET /ci/installations?agent_id=` → `ci_installations` (already per-repo) | Rows joined to latest `ci_runs` for `last_status`/`last_run_at` |
| Add-repository input | CI tab → Export Wizard → `POST /agents/:id/export-ci` | `CiExportInput` (unchanged, `eval-ci.ts`) |
| Studio URL (into target repo) | Wizard Install → GitHub API (Actions **variable**) | `DEVDIGEST_STUDIO_URL` string |
| Ingest token (into target repo) | `SecretsProvider` `CI_INGEST_TOKEN` → GitHub API (Actions **secret**) | Bearer string (value never logged) |
| Live ingest artifact | `agent-runner` upload → `POST /ci/ingest` | `CiResultArtifact` + `repository` + `commit_sha` (unchanged) |

## Untrusted inputs

| Input | Risk | Validation |
|-------|------|------------|
| `window` query param | Unbounded/expensive aggregate, injection | Zod enum `{7,30,90}`; reject/coerce (AC-UN1, AC-O3); parameterized SQL only |
| `agent_id` on `/ci/installations` and dashboard "View" | Cross-workspace data access | `getContext` workspace scoping; UUID validation (unchanged pattern) |
| Ingested `CiResultArtifact` (now live) | Forged/replayed run, spoofed repo, secret smuggling | `CiResultArtifact.safeParse` + token + repository + commit-SHA + installation match + dedupe (unchanged; `ExportToCi_1`) |
| `agent` / `model` / PR title/body in ingested/aggregated data | Prompt/HTML/shell injection into dashboard or logs | Stored/validated at ingest; rendered as inert text labels; never interpolated into commands or markup |
| `DEVDIGEST_STUDIO_URL` (repo variable, used in workflow `curl`) | SSRF-style misuse if attacker-controlled; command injection into the `curl` step | Provisioned by the studio (trusted origin); referenced via a shell-safe quoted variable; step no-ops when empty (AC-ST2); it is a variable (non-secret) by design |
| `CI_INGEST_TOKEN` (now provisioned + transmitted) | Credential leakage in transit or logs | Read only via `SecretsProvider`; sent only as a Bearer header over the operator's **private network** (self-hosted runner → local studio, never the public internet); never echoed/logged; fork PRs excluded (AC-UN3) |
| GitHub API provisioning call (secret/variable write) | Insufficient scope → partial wiring; overwrite of unrelated secret | Requires appropriate token scope; idempotent overwrite of the named secret only (AC-O1); failure surfaced, no false success (AC-UN2) |

## Open questions

All open questions were resolved with the user during spec review (2026-08-29):

- [x] **Ingest reachability mechanism** — RESOLVED: **self-hosted GHA runner only**;
  no public tunnel or hosted relay. `runs-on:` targets a configurable self-hosted
  label, `DEVDIGEST_STUDIO_URL` defaults to the local studio, reachable over the
  operator's private network (AC-U9, AC-E4b, AC-E7). Targeted at private repos with
  the fork guard enforced.
- [x] **Best-effort vs blocking ingest** — RESOLVED: runtime ingest is **best-effort**;
  studio downtime never fails the CI review job (AC-UN4).
- [x] **Remove semantics for the open `devdigest/ci` PR** — RESOLVED: Remove deletes
  only the installation row (historical `ci_runs` preserved); it does **not** close
  the open CI PR — the author closes that in GitHub (AC-E5).
- [x] **`GET /ci/performance` route ownership** — RESOLVED: lives in the **`ci`
  module**; the read-only cross-module join to `findings`/`reviews` is acceptable
  (AC-U1).
- [x] **Accept-rate definition for CI runs** — RESOLVED: derived from **local review
  `findings` only**; CI-only agents render "—" (never `0%`). Ingesting per-finding CI
  accept state is deferred as a future, non-delta iteration (AC-U3, AC-UN8).
- [x] **Trend arrow / delta window semantics** — RESOLVED: compare the selected
  window to the **immediately preceding equal-length window** (AC-E1).
- [x] **New columns vs pure joins** — RESOLVED: **derive by join** at read time; no
  denormalized columns and no migration; only new *contract* files (AC-U4, AC-U5).
- [x] **Dashboard nav grouping vs Eval Dashboard** — RESOLVED: **separate pages**,
  both in the nav (design1); not merged.

### Deferred (future iterations, not blocking implementation)

- [ ] **Per-finding CI accept state** — would let the dashboard's accept-rate gauge
  include CI runs; requires a new `CiResultArtifact` field + schema and is beyond
  this delta.
- [ ] **Retention/cleanup of `ci_runs` / `agent_runs`** — unbounded (inherited from
  `ExportToCi_1`); revisit if tables grow large.
