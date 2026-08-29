# Implementation Plan: Export to CI v2 (Delta)

**Spec:** `specs/export-to-ci-2/export-to-ci-2.spec.md` (ExportToCi_2)
**Baseline:** `specs/export-to-ci/export-to-ci.spec.md` (ExportToCi_1 — in force, NOT re-implemented)
**Scope:** server (@devdigest/api), client (@devdigest/web), shared contracts
**Estimated complexity:** high
**Multi-agent execution:** proposed yes (server + client agents in parallel after Step 1) — see Recommendations
**Created:** 2026-08-29

> **Delta-only.** Every step below states whether it EDITS an existing v1 file or ADDS a
> new file. v1 behavior (the `ci` module, the 4-step wizard, `POST /agents/:id/export-ci`,
> `POST /ci/ingest`, `GET /ci/runs`, `GET /ci/installations`, the CI tab, the CI Runs page)
> is unchanged except where a step explicitly modifies it. Do NOT re-create v1 artifacts.

## Context

`ExportToCi_1` shipped export, workflow generation, and the token-authed ingest endpoint,
but deferred three items this delta closes:

1. **Agent Performance dashboard** — a new `/agent-performance` client page (GLOBAL nav)
   backed by a new `GET /ci/performance` route in the existing `ci` module, aggregating
   `agent_runs` (local + `source='ci'`) over a `{7,30,90}`-day window (default 30) into
   total runs, total cost + delta vs previous equal window, avg accept rate gauge,
   most-active agent, a per-agent table, and by-agent / by-model cost donuts.
2. **Multi-repo installations** — the CI tab lists every `ci_installations` row for an
   agent with `last_status` / `last_run_at` derived by join to the latest `ci_runs` row,
   plus "Active in N repos", an **Add repository** action (re-enters the wizard), and a
   per-repo **Remove** action.
3. **Live CI→studio ingest round-trip (self-hosted runner only)** — the workflow's
   `runs-on:` targets a configurable self-hosted label, the previously-commented ingest
   `curl` step is emitted active (best-effort, `if: always()`), and Install provisions the
   `CI_INGEST_TOKEN` Actions **secret** + `DEVDIGEST_STUDIO_URL` Actions **variable** into
   the target repo via the GitHub API. No tunnel/relay; private repos; v1 fork guard stays.

All 8 spec open questions are RESOLVED (spec lines 429–452) and are treated as binding.

## Requirements Summary

- **Ubiquitous:** AC-U1 (route in ci module, workspace-scoped), AC-U2 (aggregate windowed
  `agent_runs` local+ci), AC-U3 (accept rate from local `findings`, null when none),
  AC-U4 (new `ci-v2.ts` contract, don't edit `eval-ci.ts`), AC-U5 (extended install shape
  via composition), AC-U6 (permissions unchanged), AC-U7 (never log tokens), AC-U8
  (`CI_INGEST_TOKEN` only via SecretsProvider), AC-U9 (self-hosted `runs-on:`).
- **Event-Driven:** AC-E1 (dashboard load/window), AC-E2 (View → agent CI tab), AC-E3 (CI
  tab per-repo rows + "Active in N repos"), AC-E4 (Add repository re-enters wizard), AC-E4b
  (Configure collects runner label + studio URL), AC-E5 (Remove deletes only the install
  row), AC-E6 (provision secret + variable), AC-E7 (best-effort ingest POST), AC-E8 (live
  run appears on CI Runs + counts toward dashboard).
- **State-Driven:** AC-ST1 (empty state), AC-ST2 (ingest no-op when URL empty), AC-ST3
  ("Active in N repos", per-repo actions never cross-repo).
- **Optional:** AC-O1 (idempotent overwrite/create secret), AC-O2 (pre-flight error when
  studio token missing), AC-O3 (reject window not in allow-list, fall back to 30).
- **Unwanted:** AC-UN1 (window 400/422), AC-UN2 (provisioning failure surfaced, no false
  success), AC-UN3 (fork → no secrets/ingest), AC-UN4 (best-effort ingest never fails job),
  AC-UN5 (ingest 401 unchanged), AC-UN6 (unknown repo/SHA 400/422 unchanged), AC-UN7 (Add
  repository already-installed → update, no duplicate row), AC-UN8 (no divide-by-zero).

## Spec Coverage Matrix

| Criterion | EARS Pattern | Plan Step(s) | Status |
|-----------|-------------|--------------|--------|
| AC-U1: `GET /ci/performance` in ci module, workspace-scoped | Ubiquitous | Step 4 | COVERED |
| AC-U2: aggregate windowed `agent_runs` local+ci | Ubiquitous | Step 2, Step 3 | COVERED |
| AC-U3: accept rate from local `findings`, null when none | Ubiquitous | Step 2, Step 3 | COVERED |
| AC-U4: new `ci-v2.ts` contract, don't edit `eval-ci.ts` | Ubiquitous | Step 1 | COVERED |
| AC-U5: extended install shape via composition | Ubiquitous | Step 1, Step 3 | COVERED |
| AC-U6: permissions block unchanged | Ubiquitous | Step 6 | COVERED |
| AC-U7: never write token values to file/log/trace | Ubiquitous | Step 6, Step 7 | COVERED |
| AC-U8: `CI_INGEST_TOKEN` only via SecretsProvider | Ubiquitous | Step 7, Step 8 | COVERED |
| AC-U9: self-hosted `runs-on:` label | Ubiquitous | Step 6 | COVERED |
| AC-E1: dashboard load/window renders all cards | Event | Step 10, Step 11 | COVERED |
| AC-E2: View → agent CI tab | Event | Step 11 | COVERED |
| AC-E3: CI tab per-repo rows + "Active in N repos" | Event | Step 3, Step 12 | COVERED |
| AC-E4: Add repository re-enters wizard | Event | Step 12, Step 13 | COVERED |
| AC-E4b: Configure collects runner label + studio URL | Event | Step 6, Step 13 | COVERED |
| AC-E5: Remove deletes only install row | Event | Step 3, Step 5, Step 12 | COVERED |
| AC-E6: provision secret + variable on Install | Event | Step 7, Step 8 | COVERED |
| AC-E7: best-effort ingest POST from workflow | Event | Step 6 | COVERED |
| AC-E8: live run appears on CI Runs + dashboard | Event | Step 6, Step 8, Step 9 | COVERED |
| AC-ST1: empty state | State | Step 3, Step 11 | COVERED |
| AC-ST2: ingest no-op when URL empty | State | Step 6 | COVERED |
| AC-ST3: "Active in N repos", per-repo actions | State | Step 12 | COVERED |
| AC-O1: idempotent overwrite/create secret | Optional | Step 7, Step 8 | COVERED |
| AC-O2: pre-flight error when studio token missing | Optional | Step 8, Step 13 | COVERED |
| AC-O3: reject window not in allow-list → 30 | Optional | Step 1, Step 4 | COVERED |
| AC-UN1: window 400/422 | Unwanted | Step 4 | COVERED |
| AC-UN2: provisioning failure surfaced, no false success | Unwanted | Step 8, Step 13 | COVERED |
| AC-UN3: fork → no secrets/ingest | Unwanted | Step 6 | COVERED |
| AC-UN4: best-effort ingest never fails job | Unwanted | Step 6 | COVERED |
| AC-UN5: ingest 401 unchanged | Unwanted | (v1, unchanged) | COVERED (no-op) |
| AC-UN6: unknown repo/SHA 400/422 unchanged | Unwanted | (v1, unchanged) | COVERED (no-op) |
| AC-UN7: Add repository already-installed → update | Unwanted | Step 5, Step 8, Step 13 | COVERED |
| AC-UN8: no divide-by-zero (accept rate null) | Unwanted | Step 2, Step 3 | COVERED |
| Edge 4: cost delta when prior window zero | (non-func) | Step 2 | COVERED |
| Edge 14: malicious agent/model strings inert | (security) | Step 11 | COVERED |
| Edge 15: no self-hosted runner registered | (advisory) | Step 13 | COVERED |
| Edge 16: public-repo advisory | (advisory) | Step 13 | COVERED |

No GAP rows remain. AC-UN5 / AC-UN6 are v1 server checks the delta explicitly does not
touch (spec: "activates the caller, not a weaker check") — covered as no-op, with a
regression assertion added in Step 9.

## Recommendations Applied

AskUserQuestion was unavailable in this environment, so each decision defaults to the
codebase-aligned recommendation (mirroring how the spec itself resolved its own Q&A).
These are called out so they can be reversed if desired:

1. **`CiProvisioner` interface, ci-module-local (Step 7).** Actions secret/variable
   provisioning goes through a NEW `CiProvisioner` interface + Octokit-backed impl inside
   the `ci` module, NOT by extending the vendor/shared `GitHubClient` interface. Extending
   `GitHubClient` would force edits to the extend-only `vendor/shared/adapters.ts` and the
   shared `MockGitHubClient` — both forbidden/high-blast-radius. A local interface keeps
   vendor/shared untouched (AC-U4 spirit) and yields a trivial test double.
2. **SQL GROUP BY in repository + pure shaping helpers in `helpers.ts` (Steps 2–3).**
   Aggregation queries live in `repository.ts` (parameterized, window-bounded, no app-side
   loops — non-functional perf requirement). Pure delta-%, gauge, donut-shaping, and
   accept-rate-null logic live in `helpers.ts` so they are unit-testable with no DB.
3. **GLOBAL nav section created in `patch-nav.ts` (Step 14).** Vendor `NAV` has only
   WORKSPACE and SKILLS LAB. The spec requires the GLOBAL group, so `patch-nav.ts` creates
   a GLOBAL `NavGroup` and pushes the Agent Performance item into it — the sanctioned
   extension point (vendor/ui is read-only).
4. **Multi-agent parallel execution proposed.** After Step 1 (shared contract) lands, the
   server track (Steps 2–9) and client track (Steps 10–14) have no cross-track file
   overlap and can run in parallel. Requires user permission.

## Architecture Constraints

- New contracts go in a NEW file `server/src/vendor/shared/contracts/ci-v2.ts`, re-exported
  via the barrel; existing `eval-ci.ts` and all other contracts are extend-only — source:
  root `CLAUDE.md` "Do not touch", `server/CLAUDE.md` "Do not touch".
- `vendor/shared/adapters.ts` (`GitHubClient`) and `adapters/mocks.ts` (`MockGitHubClient`)
  must not be edited for provisioning — source: `server/CLAUDE.md` "Do not touch". Hence
  the module-local `CiProvisioner` (Step 7).
- Modules are registered statically in `server/src/modules/index.ts`; `ci` is already
  registered — no new registration — source: root `CLAUDE.md`, `server/CLAUDE.md`.
- `CI_INGEST_TOKEN` read only via `SecretsProvider`, never DB/config/request/log — source:
  root `CLAUDE.md` "Secrets", spec AC-U7/AC-U8.
- Migrations are NOT applied on boot; this delta needs NO migration (derive-by-join
  resolved) — source: root `CLAUDE.md` Gotchas, spec Open Question "New columns vs joins".
- `INJECTION_GUARD` and the grounding gate in reviewer-core are untouched — source: root
  `CLAUDE.md`, spec Non-goals.
- Integration tests use `*.it.test.ts`; everything else is unit — source: root/`server`
  `CLAUDE.md`.
- Client: `api.ts` only sends `content-type: application/json` when a body is present; page
  files are thin, logic in colocated `_components/`; vendor is read-only — source:
  `client/CLAUDE.md`.
- Every non-ingest `ci` route calls `getContext(container, req)` first — source:
  `server/CLAUDE.md` conventions.

## Pre-implementation Checklist

- [ ] Migration needed? **NO** — `ci_runs.ci_installation_id` is already `ON DELETE SET NULL`;
  `agent_runs` already has `source`, `cost_usd`, `duration_ms`, `ran_at`, `model`,
  `agent_name`; `findings` already has `accepted_at`/`dismissed_at`; all v2 reads are joins.
- [ ] New module needed? **NO** — extend the existing `ci` module.
- [ ] New shared contracts needed? **YES** — new file `server/src/vendor/shared/contracts/ci-v2.ts`,
  add one re-export line to the barrel.
- [ ] New adapter needed? **YES** — a module-local `CiProvisioner` interface + Octokit impl
  + test double (NOT in vendor/shared, NOT in `adapters/mocks.ts`).

## Steps

### Step 1: Shared contracts for dashboard + extended installation

**Package:** server (vendor/shared)
**Files:** `server/src/vendor/shared/contracts/ci-v2.ts` (create);
`server/src/vendor/shared/index.ts` (modify — add ONE re-export line only)
**What:** Define new Zod contracts (do NOT edit `eval-ci.ts`):
- `PerfWindow = z.enum(['7','30','90'])` (or `z.coerce.number().refine(v ∈ {7,30,90})`) —
  drives AC-O3/AC-UN1 validation.
- `AgentPerfRow` { agent_id, agent_name, runs, avg_cost_usd, avg_duration_ms,
  accept_rate: number | null, trend: 'up'|'down'|'flat'|null, last_run_at: string | null }.
- `CostSlice` { key: string, cost_usd: number } (reused for by-agent and by-model donuts).
- `AgentPerformance` { window, total_runs, total_cost_usd, cost_delta_usd: number | null,
  avg_accept_rate: number | null, most_active_agent: { agent_id, agent_name, runs } | null,
  agents: AgentPerfRow[], cost_by_agent: CostSlice[], cost_by_model: CostSlice[] } (AC-U4/E1).
- `CiInstallationView = CiInstallation.extend({ agent_version: z.number().nullable(),
  last_status: z.string().nullable(), last_run_at: z.string().nullable() })` — reuse
  `CiInstallation` from `eval-ci.ts` by composition (AC-U5).
Add `export * from './contracts/ci-v2.js';` to the barrel.
**Skills:** `zod`, `typescript-expert`
**Tests:** `server/src/vendor/shared/contracts/ci-v2.test.ts` (unit) — parse valid/invalid
window, null accept_rate round-trips, `CiInstallationView` accepts a base `CiInstallation`.
**Depends on:** none
**Addresses:** AC-U4, AC-U5, AC-O3 (window enum), AC-UN1 (window enum)

### Step 2: Pure aggregation / accept-rate / delta helpers

**Package:** server
**Files:** `server/src/modules/ci/helpers.ts` (modify — append pure functions)
**What:** Add DB-free pure helpers the repository/service compose:
- `acceptRate(accepted: number, dismissed: number): number | null` — returns null when
  `accepted + dismissed === 0` (AC-U3, AC-UN8, no divide-by-zero).
- `costDelta(current: number, previous: number): number | null` — signed delta; when
  `previous === 0` return current (or null sentinel) — Edge 4, no divide-by-zero.
- `trendArrow(current: number | null, previous: number | null): 'up'|'down'|'flat'|null`.
- `toCostSlices(rows: {key,costUsd}[]): CostSlice[]` — shape + sort desc for donuts.
- `emptyPerformance(window): AgentPerformance` — zeroed cards for AC-ST1.
Keep all SQL out of this file.
**Skills:** `typescript-expert`
**Tests:** `server/src/modules/ci/helpers.test.ts` (unit) — 0/0 → null; delta with prior
zero; trend up/down/flat/null; empty shape.
**Depends on:** Step 1
**Addresses:** AC-U2 (shaping), AC-U3, AC-UN8, AC-ST1, Edge 4

### Step 3: Repository — performance aggregation + latest-run join + delete

**Package:** server
**Files:** `server/src/modules/ci/repository.ts` (modify — add methods)
**What:** Add parameterized, window-bounded SQL (GROUP BY, no app-side loops — perf NFR):
- `aggregateAgentRuns(workspaceId, since, until)` → per-agent rows (count, avg cost, avg
  duration, last ran_at, model) via `GROUP BY agent_id` over `agent_runs` where
  `workspace_id = ? AND ran_at >= since AND ran_at < until` (both `source` values counted)
  (AC-U2). Also expose totals + cost-by-model GROUP BY.
- `acceptCountsByAgent(workspaceId, since, until)` → per-agent { accepted, dismissed } by
  joining `findings` → `reviews` on `reviews.id = findings.review_id`, filtered by
  `reviews.workspace_id` and windowed by `reviews.created_at`, `GROUP BY reviews.agent_id`
  (AC-U3; accept rate derived in helper, null when none — AC-UN8).
- `listInstallationsWithLatestRun(agentId)` → each `ci_installations` row LEFT JOIN LATERAL
  (or correlated subquery) the latest `ci_runs` by `ran_at DESC` for `last_status` /
  `last_run_at` (AC-E3, AC-U5); returns `agent_version` too.
- `deleteInstallation(id, workspaceId)` → delete the row scoped by workspace (join agents
  to enforce workspace ownership before delete — multi-tenant isolation); `ci_runs` are
  preserved via existing `ON DELETE SET NULL` (AC-E5).
Reference pattern: `server/src/modules/evals/repository.ts` (`and`, `gte`, innerJoin agents
for workspace scoping).
**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`
**Tests:** covered by Step 9 integration (`.it.test.ts`) — aggregation counts, accept-rate
join, latest-run join, delete preserves ci_runs.
**Depends on:** Step 1, Step 2
**Addresses:** AC-U2, AC-U3, AC-U5, AC-E3, AC-E5, AC-UN8, AC-ST1

### Step 4: Route — `GET /ci/performance` (+ DELETE installation route)

**Package:** server
**Files:** `server/src/modules/ci/routes.ts` (modify — add routes)
**What:**
- `GET /ci/performance` with Zod query schema `{ window: PerfWindow default '30' }`; call
  `getContext(container, req)` first (AC-U1); reject out-of-allow-list window with
  400/422 (AC-UN1, AC-O3 — Zod default 30 on absent, hard reject on invalid value);
  delegate to `CiService.getPerformance(workspaceId, window)`.
- `DELETE /ci/installations/:id` — `getContext` first; delegate to
  `CiService.removeInstallation(id, workspaceId)` (AC-E5). (GET /ci/installations already
  exists in v1 and will return the extended shape via Step 3 — no new GET route.)
**Skills:** `fastify-best-practices`, `zod`
**Tests:** covered by Step 9 integration (window 200/400, workspace scoping, delete 200).
**Depends on:** Step 3, Step 5
**Addresses:** AC-U1, AC-UN1, AC-O3, AC-E5

### Step 5: Service — performance orchestration + remove + already-installed update

**Package:** server
**Files:** `server/src/modules/ci/service.ts` (modify)
**What:**
- `getPerformance(workspaceId, window)` — compute `since`/`until` for the selected and the
  immediately preceding equal-length windows; call repo aggregation for both; compose via
  Step 2 helpers into `AgentPerformance` (total cost delta, per-agent accept rate + trend,
  most-active agent, cost donuts); return `emptyPerformance` when no rows (AC-ST1). Windows
  derived once server-side — bounded aggregate (perf NFR).
- `listInstallations(agentId)` — switch to `listInstallationsWithLatestRun` and return the
  `CiInstallationView` shape (AC-E3, AC-U5).
- `removeInstallation(id, workspaceId)` — validate ownership then delete (AC-E5).
- `exportCi` — reuse the existing v1 find-open-PR / upsert path so that Add-repository for
  an already-installed repo is an update, not a duplicate row (AC-UN7); confirm no second
  `insertInstallation` for the same `(agent, repo)`.
**Skills:** `typescript-expert`
**Tests:** `server/src/modules/ci/service.test.ts` (unit, extend existing) — performance
composition with mocked repo, empty-state, remove ownership guard, already-installed → no
duplicate.
**Depends on:** Step 2, Step 3
**Addresses:** AC-U2, AC-U3, AC-ST1, AC-E5, AC-UN7, AC-E1 (data shape)

### Step 6: Workflow generator — self-hosted runner + active best-effort ingest

**Package:** server
**Files:** `server/src/modules/ci/workflow.ts` (modify);
`server/src/modules/ci/constants.ts` (modify — add defaults)
**What:**
- Extend `GenerateWorkflowInput` with `runnerLabel: string[]` (default from constant) and
  `studioUrl: string`.
- Set `'runs-on'` from `runnerLabel` (default `['self-hosted','devdigest']`) instead of the
  hard-coded `'ubuntu-latest'` (AC-U9). No tunnel/relay config emitted.
- Replace the commented ingest block (lines 135–145) with an ACTIVE step: `if: always()`,
  a shell-safe guard that no-ops when `$DEVDIGEST_STUDIO_URL` is empty (AC-ST2), and a
  `curl` that never fails the job (e.g. tolerate non-2xx / trailing `|| true`) (AC-E7,
  AC-UN4). Reference token only as `${{ secrets.CI_INGEST_TOKEN }}` and URL only via a
  quoted `env:` var mapped from `${{ vars.DEVDIGEST_STUDIO_URL }}` — never interpolate raw
  values (AC-U7).
- Keep the `permissions:` block exactly `contents: read` + `pull-requests: write` (AC-U6)
  and the fork-guard job `if` unchanged (AC-UN3).
- Add constants: default runner label, default studio URL (`http://localhost:3001`), and
  `DEVDIGEST_STUDIO_URL` variable-name constant.
**Skills:** `security`, `typescript-expert`
**Tests:** `server/src/modules/ci/workflow.test.ts` (unit, extend) — runs-on = configured
label; ingest step present + `if: always()` + empty-URL no-op + non-failing; permissions
block unchanged; token appears only as `${{ secrets.* }}`; fork guard present.
**Depends on:** Step 1
**Addresses:** AC-U6, AC-U7, AC-U9, AC-E4b (consumes), AC-E7, AC-ST2, AC-UN3, AC-UN4

### Step 7: `CiProvisioner` interface + Octokit implementation

**Package:** server
**Files:** `server/src/modules/ci/provisioner.ts` (create);
`server/src/adapters/github/octokit.ts` (modify OR new sibling `ci-provisioner.ts` in
adapters — implementation only, NOT the shared interface)
**What:** Define a module-local interface (NOT in vendor/shared):
```
interface CiProvisioner {
  createOrUpdateActionsSecret(owner, repo, name, value): Promise<void>; // sealed-box
  setActionsVariable(owner, repo, name, value): Promise<void>;          // create or update
}
```
Octokit-backed impl: `getRepoPublicKey` → libsodium sealed-box encrypt →
`actions.createOrUpdateRepoSecret` (idempotent overwrite/create — AC-O1); variable via
`createRepoVariable`, falling back to `updateRepoVariable` on 409 (idempotent). Reuse the
existing `container.github()` GITHUB_TOKEN resolution; never log secret values (AC-U7).
Errors propagate (surfaced by Step 8).
**Skills:** `security`, `typescript-expert`
**Tests:** `server/src/modules/ci/provisioner.test.ts` (unit) with a stub Octokit — sealed-
box path called for secret, create-then-update fallback for variable, no value logged.
**Depends on:** none (parallel with Steps 2–6)
**Addresses:** AC-E6, AC-O1, AC-U7, AC-U8 (consumes token from SecretsProvider via Step 8)

### Step 8: Wire provisioning into Install + pre-flight token check

**Package:** server
**Files:** `server/src/modules/ci/service.ts` (modify — extend `exportCi` install path);
`server/src/platform/container.ts` (modify — add lazy `ciProvisioner()` getter +
`ContainerOverrides` entry)
**What:**
- Pre-flight: read `CI_INGEST_TOKEN` via `SecretsProvider` (`CI_INGEST_TOKEN_KEY`); if
  absent/empty, return a clear pre-flight error and do NOT provision an empty secret
  (AC-O2, AC-U8).
- After the PR is opened (action `open_pr`), call `CiProvisioner` to create/overwrite the
  `CI_INGEST_TOKEN` secret and set the `DEVDIGEST_STUDIO_URL` variable (from the wizard's
  configured URL) in the target repo (AC-E6, AC-O1).
- On provisioning failure, return a structured result: PR opened = true, ingest-wiring =
  incomplete + error message — never a false working-round-trip claim (AC-UN2). Log
  server-side without secret values (AC-U7).
- Add `ciProvisioner()` to the Container (lazy, resolves via `container.github()` token) and
  a `ContainerOverrides.ciProvisioner` slot for tests.
- Do NOT provision for fork PRs / non-open_pr actions (defense with the workflow fork guard,
  AC-UN3).
**Skills:** `security`, `typescript-expert`, `fastify-best-practices`
**Tests:** covered by Step 5 unit (result-shape with mocked provisioner: success,
provisioning-failure → incomplete, missing-token → pre-flight error) and Step 9 integration.
**Depends on:** Step 7
**Addresses:** AC-E6, AC-O1, AC-O2, AC-U7, AC-U8, AC-UN2, AC-UN3, AC-UN7 (update path)

### Step 9: Server integration tests

**Package:** server
**Files:** `server/src/modules/ci/performance.it.test.ts` (create);
`server/src/modules/ci/installations.it.test.ts` (create)
**What:** Using the `onboarding/routes.it.test.ts` pattern (startPg, `hasDocker` gate,
seed, `buildApp`, `ContainerOverrides` mocks for github + `ciProvisioner`):
- Performance: seed `agent_runs` (local + ci) across windows + `findings`/`reviews`; assert
  totals, delta vs previous window, per-agent accept rate + null case, cost donuts;
  window 400 on invalid value; workspace isolation.
- Installations: extended shape (`last_status`/`last_run_at` from latest ci_run); DELETE
  removes only the install row and preserves `ci_runs` (set null); export idempotency for
  already-installed repo (no duplicate row, AC-UN7); provisioning invoked on open_pr;
  provisioning failure → incomplete result (AC-UN2); ingest 401 and unknown-repo 400
  regression (AC-UN5/AC-UN6 unchanged).
**Skills:** `fastify-best-practices`, `drizzle-orm-patterns`
**Tests:** these ARE the tests.
**Depends on:** Step 4, Step 5, Step 8
**Addresses:** AC-U1, AC-U2, AC-U3, AC-U5, AC-E3, AC-E5, AC-E6, AC-E8, AC-O1, AC-O2,
AC-UN1, AC-UN2, AC-UN5, AC-UN6, AC-UN7, AC-UN8, AC-ST1

### Step 10: Client hooks — performance, remove, extended installations

**Package:** client
**Files:** `client/src/lib/hooks/ci.ts` (modify)
**What:** Add `useAgentPerformance(window)` (GET `/ci/performance?window=` via `apiFetch`,
window in the query path per `api.ts`), typed to `AgentPerformance` from
`@devdigest/shared`; add `useRemoveInstallation()` mutation (DELETE
`/ci/installations/:id`, no body → `api.ts` omits content-type correctly) that invalidates
the installations query; update `useCiInstallations` typing to `CiInstallationView[]`.
**Skills:** `react-best-practices`, `typescript-expert`
**Tests:** exercised via component tests in Steps 11–12.
**Depends on:** Step 1 (types via client vendor/shared copy)
**Addresses:** AC-E1, AC-E3, AC-E5 (client wiring)

### Step 11: Client — Agent Performance page + view components

**Package:** client
**Files:** `client/src/app/agent-performance/page.tsx` (create — thin);
`client/src/components/AgentPerformance/*` (create — view, cards, gauge, donuts, per-agent
table, window selector, `index.ts`, `.test.tsx`)
**What:** Thin page (AppShell + crumb) mirroring `eval-dashboard/page.tsx` and
`ci-runs/page.tsx`. View renders TOTAL RUNS, TOTAL COST + signed delta, AVG ACCEPT RATE
gauge, MOST-ACTIVE AGENT, per-agent table (runs, avg cost, avg duration, accept rate as
"—" when null, trend arrow, last run, **View** link → `/agents/[id]` CI tab per AC-E2), and
By-agent / By-model cost donuts (Recharts) with text labels/values (a11y NFR). Window
selector `{7,30,90}` default 30 (AC-E1). Empty state when zeroed (AC-ST1). Render all
agent/model strings as inert text — never `dangerouslySetInnerHTML` (Edge 14). Follow the
inline-CSSProperties + CSS-vars styling convention.
**Skills:** `next-best-practices`, `react-frontend-best-practices`, `react-best-practices`,
`react-testing-library`
**Tests:** `client/src/components/AgentPerformance/*.test.tsx` — renders cards from mocked
hook; "—" for null accept rate; empty state; window change refetch; View link href; inert
string rendering.
**Depends on:** Step 10
**Addresses:** AC-E1, AC-E2, AC-ST1, Edge 14

### Step 12: Client — CI tab multi-repo list + Remove + Add repository

**Package:** client
**Files:** `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.tsx`
(modify) and colocated helpers/tests
**What:** Render one row per installation (repo, target type, `last_status`, `last_run_at`),
an "Active in N repos" summary (AC-E3, AC-ST3), a per-repo **Remove** with a confirm step
(a11y NFR) calling `useRemoveInstallation` then refresh (AC-E5), and an **Add repository**
button that opens the Export Wizard scoped to add a repo (AC-E4). Per-repo actions operate
only on that row, never across repos (AC-ST3). Keep v1 CI-tab patterns.
**Skills:** `react-frontend-best-practices`, `react-best-practices`, `react-testing-library`
**Tests:** CI tab test — N rows + "Active in N repos"; Remove confirm → mutation + refresh;
Add repository opens wizard; per-repo isolation.
**Depends on:** Step 10, Step 13
**Addresses:** AC-E3, AC-E4, AC-E5, AC-ST3

### Step 13: Client — wizard Configure fields + Install provisioning outcome + advisories

**Package:** client
**Files:** `client/src/components/CiExportWizard/CiExportWizard.tsx` (modify) and its
`StepConfigure` / `StepInstall` subcomponents + tests
**What:**
- StepConfigure: add self-hosted **runner label** input (default `self-hosted, devdigest`)
  and **studio URL** input (default `http://localhost:3001`), carried into the export body
  so the server sets `runs-on:` (AC-U9) and provisions `DEVDIGEST_STUDIO_URL` (AC-E6) —
  AC-E4b.
- StepInstall: surface the structured provisioning outcome — success vs "PR opened, ingest
  wiring incomplete" with the error (AC-UN2), and the pre-flight "studio CI_INGEST_TOKEN not
  configured" error (AC-O2). Show a private-repo advisory and a "self-hosted runner must be
  registered" note (Edge 15, Edge 16).
- Ensure Add-repository re-uses the same wizard so an already-installed repo results in an
  update, not a duplicate (AC-E4, AC-UN7 — server-enforced in Step 5).
**Skills:** `react-frontend-best-practices`, `react-best-practices`, `react-testing-library`
**Tests:** wizard test — Configure fields present with defaults + carried into submit;
Install renders success / incomplete-wiring / pre-flight-error states; advisories shown.
**Depends on:** Step 10
**Addresses:** AC-E4, AC-E4b, AC-O2, AC-UN2, AC-UN7 (client), Edge 15, Edge 16

### Step 14: Client — GLOBAL nav item for Agent Performance

**Package:** client
**Files:** `client/src/components/app-shell/patch-nav.ts` (modify)
**What:** Create a GLOBAL `NavGroup` (vendor `NAV` has none) and push an
`AGENT_PERFORMANCE_ITEM` (key `agent-performance`, href `/agent-performance`, an existing
Icon-registry icon, a non-colliding `gKey`). Guard against double-push like the existing
items. Keep the item distinct from Eval Dashboard (both remain in nav).
**Skills:** `react-best-practices`, `typescript-expert`
**Tests:** covered indirectly; optional assertion that NAV contains a GLOBAL group with the
item.
**Depends on:** Step 11 (page must exist for the route to resolve)
**Addresses:** AC-E1 (navigation entry), nav-grouping resolution

## Proactive Skills That Will Fire

- `engineering-insight` — WILL fire (each track changes 3+ files); invoke before summarizing.
- `breaking-change` — WILL fire — a new route (`GET /ci/performance`), a new route
  (`DELETE /ci/installations/:id`), and an extended `GET /ci/installations` response shape.
- `response-schema` — WILL fire — new `AgentPerformance` shape and extended installation
  response.
- `deprecation-policy` — WON'T fire — no public API removed.
- `semver-discipline` — MAY fire — additive routes/contracts suggest a minor bump.

## Risk Assessment

- **Persisted-data compatibility:** none broken — no schema change, all reads are joins over
  existing columns; extended install shape is additive. Mitigation: contract tests (Step 1).
- **libsodium sealed-box for Actions secrets:** required by GitHub API; verify a sodium lib
  is available (or already a transitive dep of Octokit) before Step 7 — if not present it is
  the only new dependency. Mitigation: check `server/package.json` before adding; prefer an
  already-installed crypto lib. FLAG: confirm during Step 7.
- **Multi-tenant isolation on DELETE:** FK alone is insufficient. Mitigation: Step 3/5
  scope delete by workspace (join agents), asserted in Step 9.
- **Best-effort ingest correctness:** a `curl` that returns non-2xx must not fail the job.
  Mitigation: explicit non-failing shell + empty-URL no-op, unit-asserted in Step 6.
- **Accept-rate windowing surprise:** `findings` has no timestamp — windowed via
  `reviews.created_at`. Mitigation: documented in Step 3, asserted in Step 9 (null case).
- **Token leakage:** provisioning/logging must never echo secret values. Mitigation: Step 7/8
  log without values; Step 6 references token only as `${{ secrets.* }}`.
- **Cost delta divide-by-zero when prior window cost is 0.** Mitigation: `costDelta` helper
  handles zero prior (Step 2, Edge 4).

## Out of Scope

- CircleCI / Jenkins / Generic CLI generators — GHA-only (spec Non-goals).
- reviewer-core, injection guard, grounding gate, agent-runner — untouched (spec Non-goals).
- Editing `eval-ci.ts` or any existing shared contract / schema column (extend-only).
- Public tunnels / hosted ingest relays — self-hosted runner only (spec Non-goals).
- Per-finding CI accept state, secret rotation UI, retention/cleanup, dashboard pagination
  beyond the time-window bound (spec Non-goals / Deferred).
- Any new DB migration — derive-by-join resolved (spec Open Questions).
