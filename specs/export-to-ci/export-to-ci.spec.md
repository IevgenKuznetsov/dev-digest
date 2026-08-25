# Spec: Export to CI

Spec ID: ExportToCi_1
Status: draft
Supersedes: —

## Problem and User

Agent authors (developers who build and tune review agents in the DevDigest studio) can
currently only run an agent's review locally, from the studio, against a PR they open by
hand. There is no way to make a technically-tuned agent run automatically inside a target
repository's CI on every pull request. The agent's configuration — model, system prompt,
attached skills, and gate policy — lives only in the studio's database and cannot be
carried into someone else's GitHub Actions environment.

Export to CI closes that gap. An agent is a versioned configuration (model, system prompt,
skills, parameters). Export serializes it into a portable manifest at
`.devdigest/agents/<slug>.yaml`, bundles the already-built `agent-runner` and a
least-privilege GitHub Actions workflow, and opens a pull request in the target repo (or
offers a zip). The studio and the runner validate the manifest with the **same** Zod schema
(`AgentManifest` in `server/src/vendor/shared/contracts/eval-ci.ts`), so the configuration
never drifts between the two ends.

An identical manifest guarantees identical *configuration*, not byte-identical *output*:
model responses vary and CI tool versions differ. So each ingested run records the manifest
version, model, and commit SHA for provenance. The author can then watch CI runs — verdict,
findings, cost, duration, job link — from a CI Runs page and a per-agent CI tab.

The user persona is the **agent author**. Their current pain: a tuned agent is trapped in
the studio and cannot guard real PRs in the repos their team actually ships from.

## Goals / Non-goals

### Goals

- Add a server `ci` module (`server/src/modules/ci/`: `routes.ts`, `service.ts`,
  `repository.ts`, `helpers.ts`, `constants.ts`, `workflow.ts`) registered once in
  `server/src/modules/index.ts`.
- Implement `POST /agents/:id/export-ci` that generates the file bundle (agent manifest
  YAML, skill markdown files, optional `.devdigest/memory.jsonl`, the bundled runner, and
  an editable GitHub Actions workflow), then either commits the files to a new
  `devdigest/ci` branch and opens a PR, or returns the files for zip download — per
  `CiExportInput.action` (`open_pr` | `files`).
- Generate a **GitHub-Actions-only** workflow (`.github/workflows/devdigest-review.yml`)
  that honors every security requirement below (least-privilege `permissions`, secret from
  Actions Secrets, no fork-PR secret exposure, pinned SHAs, in-repo runner invocation).
- Implement an authenticated `POST /ci/ingest` that validates `CiResultArtifact` plus the
  commit SHA, repository id, and request authenticity, then writes an `agent_runs` row with
  `source='ci'` and upserts a `ci_runs` row.
- Implement `GET /ci/runs` (CI Runs page) and `GET /ci/installations` (agent CI tab).
- Add a client agent **CI tab**, a **4-step Export Wizard** (Target → Preview → Configure →
  Install, GHA-only), and a **CI Runs** navigation page with a filterable, auto-refreshing
  table.
- Reuse existing scaffolding without redefinition: the `AgentManifest` / `CiExportInput` /
  `CiExport` / `CiFile` / `CiRun` / `CiResultArtifact` / `CiInstallation` contracts in
  `server/src/vendor/shared/contracts/eval-ci.ts`; the `ci_installations` and `ci_runs`
  tables in `server/src/db/schema/ci.ts`; the `agent_runs.source` column in
  `server/src/db/schema/runs.ts`; the GitHub client in
  `server/src/adapters/github/octokit.ts` (`commitFiles`, `openPullRequest`, `findOpenPr`);
  the bundled runner in `agent-runner/`; and the client primitives
  `client/src/vendor/ui/kit/Modal.tsx` and `client/src/vendor/ui/ExportWizardSteps.tsx`.

### Non-goals

- **CircleCI, Jenkins, Generic CLI targets.** Only GitHub Actions is in scope for v1. Other
  `CiTarget` enum values may be *shown* as alternative cards ONLY if their generators are
  actually implemented; they are not, so v1 offers GHA only. (See Edge cases.)
- **Publishing a marketplace action.** `uses: devdigest/review-action@v1` remains a
  commented-out placeholder in the generated workflow; the runner ships inside the exported
  PR and is invoked from the repo (`node .devdigest/runner/index.js`).
- **Changing the agent-runner.** The runner (`agent-runner/src/`) is already built and
  tested; this spec generates the manifest/workflow it consumes and ingests its artifact.
  It does not modify runner logic, the reviewer-core pipeline, grounding, or the injection
  guard.
- **Editing existing contracts or schema.** `server/src/vendor/shared/` is extend-only; this
  spec reuses the existing `eval-ci.ts` contracts as-is. The only schema change is a new
  migration adding nullable provenance columns (`commit_sha`, `model`, `manifest_version`)
  to `ci_runs`; no existing column is altered.
- **Live CI→studio ingest round-trip.** v1 generates the `POST /ci/ingest` call in the
  workflow and implements the server endpoint, but does not solve reachability from
  GitHub-hosted runners to the local-first studio. End-to-end ingest wiring (self-hosted
  runner / tunnel / hosted ingest) is deferred to a later iteration.
- **The multi-run service and the PR feed.** Per the requirements, worktree B touches
  `ci/`, its routes, CI Runs, and the agent CI tab only; it does not modify the multi-run
  service or the PR stream.
- **Relationship to the Eval Pipeline spec.** `specs/eval-pipeline/eval-pipeline.spec.md`
  (`EvalPipeline_1`) covers local regression evals and also writes `agent_runs`. This spec
  is **separate and complementary**: it owns the `ci` module, `/ci/*` routes, the wizard,
  the CI tab, and the CI Runs page, and it writes `agent_runs` with `source='ci'`. The two
  specs share the `agent_runs` table but never the same rows (local vs ci `source`).
- **Automatic re-export on agent edit.** Re-export is user-initiated ("Update CI config").
- **Secret rotation / management UI** for the CI ingest token.

## User stories

- As an agent author, I want an **Add to CI** button on my agent's CI tab that opens a
  4-step wizard, so that I can install my tuned agent into a repo's pull-request checks
  without hand-writing YAML.
- As an agent author, I want the wizard to **preview** the exact manifest, skills,
  memory, and editable workflow before I commit, so that I can review and tweak the
  workflow before it lands.
- As an agent author, I want to **configure** which `pull_request` events trigger the review
  (`opened`, `synchronize`, optionally `reopened`) and how the result is published
  (`github_review` | `pr_comment` | `none`), so that the integration matches my team's flow.
- As an agent author, I want the wizard to **open a PR** on a dedicated `devdigest/ci`
  branch (never write to `main`) or let me **download a zip**, so that the installation goes
  through normal review.
- As an agent author, I want a **CI Runs** page listing repository, PR, agent, verdict,
  findings, cost, duration, and a job link, filterable and auto-refreshing, so that I can
  monitor how my agent performs in CI.
- As an agent author, I want a **CI tab** on the agent page showing installations, the
  installed workflow version, run history, and the "Fail CI on" setting, so that I can
  manage the agent's CI presence in one place.
- As a security-conscious author, I want the generated workflow to grant only the minimum
  `GITHUB_TOKEN` permissions and never expose `OPENROUTER_API_KEY` to fork PRs, so that
  installing the agent does not widen my repo's attack surface.

## Acceptance criteria (EARS)

Design decisions resolved during Q&A (interactive tool unavailable; simplest-viable v1
choices adopted per the requirements text):

- **Ingest authenticity** is a shared bearer token (`CI_INGEST_TOKEN`) read via
  `SecretsProvider`, plus artifact-level validation of commit SHA and repository id.
- **`memory.jsonl`** is included when the agent has memory data, omitted otherwise.
- **Install** supports both PR (primary) and zip (fallback), mapping to
  `CiExportInput.action` `open_pr` / `files`.
- **Provenance storage**: a new migration adds nullable `commit_sha`, `model`, and
  `manifest_version` columns to `ci_runs` (schema is extend-only — new columns/migration
  are allowed; existing columns are not altered). Ingest populates them from the artifact.
- **Ingest reachability**: the generated workflow *contains* the `POST /ci/ingest` call,
  but a working end-to-end round-trip from GitHub-hosted runners to the local-first studio
  is **out of scope for v1** (the studio is not publicly reachable by default). v1 ships the
  server-side ingest endpoint and the workflow's call to it; live network wiring
  (self-hosted runner / tunnel / hosted ingest) is deferred.

### Ubiquitous (always true, no trigger)

- AC-U1: The system shall register the `ci` module in `server/src/modules/index.ts` as a
  Fastify plugin at `server/src/modules/ci/routes.ts`.
- AC-U2: The system shall scope every `ci` route to the current workspace via
  `getContext(container, req)` before performing any work, consistent with all other
  modules — except `POST /ci/ingest`, which authenticates via the CI ingest token (AC-S1).
- AC-U3: The system shall serialize the agent to an `AgentManifest`-shaped YAML at
  `.devdigest/agents/<slug>.yaml`, validated against `AgentManifest` from
  `server/src/vendor/shared/contracts/eval-ci.ts` before it is written into the bundle.
- AC-U4: The system shall generate the workflow at
  `.github/workflows/devdigest-review.yml` with `permissions:` set to exactly
  `contents: read` and `pull-requests: write` (all other permissions default to `none`).
- AC-U5: The system shall reference `OPENROUTER_API_KEY` in the workflow only via
  `${{ secrets.OPENROUTER_API_KEY }}` and shall never write the key value into the manifest,
  the workflow file, any generated artifact, log line, or trace.
- AC-U6: The system shall pin every external GitHub Action referenced in the workflow to a
  full commit SHA, and shall include `uses: devdigest/review-action@v1` only as a
  commented-out placeholder (the runner is invoked in-repo via
  `node .devdigest/runner/index.js`).
- AC-U7: The system shall persist a `ci_installations` row (`agent_id`, `repo`,
  `target_type='gha'`, `installed_at`) for each successful export.
- AC-U8: The `CiFile` for the workflow shall be `editable: true`; the manifest, skills,
  memory, and runner files shall be `editable: false`.

### Event-Driven (triggered by an event)

- AC-E1: When the author clicks **Add to CI** on the agent CI tab, the system shall open the
  Export Wizard modal at step 1 (Target) with GitHub Actions preselected.
- AC-E2: When the author advances past the Target step, the system shall show a Preview step
  rendering the manifest, the resolved skills, the `.devdigest/memory.jsonl` contents (when
  present), and the editable `.github/workflows/devdigest-review.yml`.
- AC-E3: When the author edits the workflow YAML in Preview and continues, the system shall
  carry the edited contents through to the commit/zip step unchanged.
- AC-E4: When the author sets triggers and publish mode in Configure and clicks Install with
  action `open_pr`, the system shall build the file set, call
  `commitFiles(repo, { branch: 'devdigest/ci', base, files, message })`, then
  `openPullRequest(repo, { title, head: 'devdigest/ci', base, body })`, and return
  `CiExport { installation, files, pr_url }`.
- AC-E5: When the author selects the zip option (action `files`), the system shall return
  the `CiExport` with `files` populated and `pr_url: null`, and the client shall assemble
  and download a zip of those files client-side.
- AC-E6: When `POST /ci/ingest` receives a valid, authenticated artifact, the system shall
  insert an `agent_runs` row with `source='ci'` (populating `model`, `provider`,
  `durationMs`, `costUsd`, `status`, `findingsCount` from the artifact where available) and
  upsert a `ci_runs` row keyed on `(ci_installation_id, pr_number, commit SHA)`, recording
  the provenance fields `commit_sha`, `model`, and `manifest_version` on that `ci_runs` row.
- AC-E10: The system shall add a new Drizzle migration adding nullable `commit_sha`,
  `model`, and `manifest_version` columns to `ci_runs` (`server/src/db/schema/ci.ts`); no
  existing column is altered.
- AC-E7: When the CI Runs page loads or its auto-refresh interval elapses, the system shall
  call `GET /ci/runs` (with the active filters) and render repository, PR, agent, source,
  duration, findings, cost, status, and a trace/job link per row.
- AC-E8: When the agent CI tab loads, the system shall call `GET /ci/installations` scoped
  to that agent and render installations, the installed workflow version, run history, and
  the "Fail CI on" (`ci_fail_on`) setting.
- AC-E9: When the author clicks **Update CI config** for a repo that already has an open
  `devdigest/ci` PR, the system shall reuse `findOpenPr(repo, 'devdigest/ci')` to update the
  existing branch/PR rather than opening a duplicate.

### State-Driven (true while a condition holds)

- AC-ST1: While the Export Wizard is on the Target step, the system shall present GitHub
  Actions as the only selectable target and shall render CircleCI, Jenkins, and Generic CLI
  as disabled/non-selectable (their generators are not implemented).
- AC-ST2: While an export request is in flight, the system shall disable the wizard's
  Install/Continue control and show a pending state, so the author cannot double-submit.
- AC-ST3: While the CI Runs page auto-refresh is enabled, the system shall re-query
  `GET /ci/runs` on a fixed interval without a full-page reload (TanStack Query
  `refetchInterval`).

### Optional Feature (conditional on feature presence)

- AC-O1: Where the agent has `.devdigest/memory.jsonl` data available, the system shall
  include that file in the export bundle; where it does not, the system shall omit the file
  entirely (no empty artifact is written).
- AC-O2: Where the Configure step includes `reopened` in the selected triggers, the system
  shall add `reopened` to the workflow's `pull_request:` `types:` list; where it is
  excluded, only `opened` and `synchronize` shall be emitted.
- AC-O3: Where publish mode is `none`, the workflow shall still run the review and upload the
  `devdigest-result.json` artifact for ingest, but shall set `DEVDIGEST_POST_AS=none` so the
  runner posts nothing to the PR.

### Unwanted Behavior (error/fault handling)

- AC-UN1: If `POST /ci/ingest` is called without a valid `CI_INGEST_TOKEN` bearer credential,
  then the system shall reject the request with `401` and shall not write any `agent_runs`
  or `ci_runs` row.
- AC-UN2: If an ingested artifact fails `CiResultArtifact` schema validation, or its
  repository id / commit SHA does not match a known installation, then the system shall
  reject it with `400`/`422` and shall not persist a run.
- AC-UN3: If `commitFiles` or `openPullRequest` fails (e.g. missing `GITHUB_TOKEN`, no push
  access, branch conflict), then the system shall surface the error to the wizard and shall
  not record a `ci_installations` row for the failed export.
- AC-UN4: If the target repo already has a `.github/workflows/devdigest-review.yml`, then
  the system shall overwrite it on the `devdigest/ci` branch (atomic `commitFiles` from
  `base`) and shall not touch `main`.
- AC-UN5: If the triggering PR originates from a fork, then the generated workflow shall not
  expose secrets or run the review job (a job-level `if` guarding against
  `head.repo.fork`), and shall not use `pull_request_target` with an untrusted checkout.
- AC-UN6: If a duplicate artifact for the same `(installation, pr_number, commit SHA)`
  arrives, then the system shall update the existing `ci_runs` row rather than inserting a
  duplicate.
- AC-UN7: If the agent slug cannot be resolved or the manifest fails `AgentManifest`
  validation at export time, then the system shall abort the export with a descriptive error
  and shall not open a PR or write any files.

### Out of scope

- **The review pipeline, grounding gate, and injection guard.** Owned by `reviewer-core` and
  consumed unchanged by `agent-runner`; this spec neither invokes nor modifies them.
- **The runner's own exit-code / gate computation.** The deterministic gate
  (`countBlockers` / `gateTriggered` against `ci_fail_on`) lives in `agent-runner/src/` and
  is out of scope here; this spec only sets `ci_fail_on` in the exported manifest.
- **GitHub webhook receipt of CI status.** Ingest is via the runner uploading
  `devdigest-result.json` to `POST /ci/ingest`; live webhook wiring is deferred.
- **Non-GHA workflow generation.** No CircleCI/Jenkins/CLI generator is written; those cards
  are inert.
- **Retention/cleanup of `ci_runs`.** Unbounded for v1 (see Open Questions).

## Edge cases

| # | Scenario | Expected behavior |
|---|----------|-------------------|
| 1 | Author re-runs export for a repo with an open `devdigest/ci` PR | Reuse `findOpenPr`; update the existing branch/PR, no duplicate PR (AC-E9). |
| 2 | PR to the target repo comes from a fork | Workflow's fork guard prevents the job from running with secrets; no secret exposure (AC-UN5). |
| 3 | Agent has no memory data | `.devdigest/memory.jsonl` omitted from bundle; Preview shows no memory row (AC-O1). |
| 4 | Author edits the workflow YAML in Preview | Edited contents flow through to commit/zip verbatim (AC-E3). |
| 5 | Ingest artifact replayed (same commit SHA + PR) | Existing `ci_runs` row updated, not duplicated (AC-UN6). |
| 6 | Ingest called with wrong/absent token | `401`, nothing persisted (AC-UN1). |
| 7 | Ingest artifact repository id / commit SHA unknown | `400`/`422`, nothing persisted (AC-UN2). |
| 8 | `commitFiles` fails (no push access) | Error surfaced to wizard; no installation row (AC-UN3). |
| 9 | Target repo already has `devdigest-review.yml` | Overwritten on `devdigest/ci` branch only; `main` untouched (AC-UN4). |
| 10 | Author picks zip instead of PR | `pr_url: null`; files returned; client builds zip (AC-E5). |
| 11 | Author selects CircleCI/Jenkins/CLI card | Card is disabled/non-selectable; only GHA proceeds (AC-ST1). |
| 12 | Publish mode `none` | Review runs, artifact uploaded/ingested, nothing posted to PR (AC-O3). |
| 13 | Malicious PR title/body/branch name in ingested artifact context | Treated as untrusted data; never interpolated into shell or privileged instructions (the runner already wraps untrusted input; ingest stores as data only). |

## Non-functional requirements

- **Performance**: Export is a single request bounded by the GitHub API round-trips for
  `commitFiles` + `openPullRequest`; no long-running job. CI Runs auto-refresh uses a modest
  interval (e.g. 15–30s) to avoid hammering `GET /ci/runs`.
- **Security**:
  - Generated workflow `permissions:` is exactly `contents: read` + `pull-requests: write`;
    everything else is `none` (AC-U4).
  - `OPENROUTER_API_KEY` is sourced only from GitHub Actions Secrets; never in manifest,
    workflow, artifact, log, or trace (AC-U5).
  - Fork PRs get no secrets and no untrusted-code execution; no `pull_request_target` +
    checkout of PR head (AC-UN5).
  - Diff, branch names, PR body, and comments are untrusted; the runner already wraps them
    via `wrapUntrusted` + `INJECTION_GUARD`, and ingest stores them as inert data.
  - External actions pinned to full commit SHA (AC-U6).
  - `devdigest-result.json` contains no secrets; ingest validates schema + commit SHA +
    repository id + request authenticity (AC-U2, AC-E6, AC-UN1, AC-UN2).
  - `POST /ci/ingest` authenticated via `CI_INGEST_TOKEN` bearer, read through
    `SecretsProvider` (`server/src/adapters/secrets/local.ts`), never from DB or config.
- **Accessibility**: Wizard is keyboard-navigable (uses `client/src/vendor/ui/kit/Modal.tsx`
  focus handling); step indicator via `client/src/vendor/ui/ExportWizardSteps.tsx`. CI Runs
  table has accessible column headers and filter controls.
- **Observability**: Each ingested run is recorded in `agent_runs` (`source='ci'`) and
  `ci_runs` with manifest version, model, and commit SHA for provenance; export failures are
  logged server-side (without secrets).

## Inputs and provenance

| Input | Source | Format |
|-------|--------|--------|
| Agent config (model, system prompt, skills, `ci_fail_on`, strategy) | Studio DB (`agents` table) via the agents module | Serialized to `AgentManifest` YAML |
| Export request (repo, target, action, post_as, triggers, base) | Wizard → `POST /agents/:id/export-ci` | `CiExportInput` (`eval-ci.ts`) |
| Bundled runner | `agent-runner/dist/index.js` (ncc output) | Embedded as `.devdigest/runner/index.js` |
| Skill markdown | Skills module / `.devdigest/skills/<slug>.md` | Text |
| `memory.jsonl` (optional) | Agent memory, when present | JSONL |
| CI result artifact | `agent-runner` upload → `POST /ci/ingest` | `CiResultArtifact` (`eval-ci.ts`) |
| Commit SHA / repository id | GitHub Actions env in the target repo | Strings, validated at ingest |
| CI ingest token | `SecretsProvider` (`~/.devdigest/secrets.json`, env fallback) key `CI_INGEST_TOKEN` | Bearer string |
| GitHub token (for commit/PR) | `SecretsProvider` key `GITHUB_TOKEN` | Bearer string |

## Untrusted inputs

| Input | Risk | Validation |
|-------|------|------------|
| `CiExportInput` body (repo, triggers, base, post_as, action) | Injection into workflow YAML / GitHub API; malformed repo slug | Parse with `CiExportInput` Zod; validate `repo` as `owner/name`; enum-constrain target/action/post_as; emit triggers via a fixed allow-list (`opened`, `synchronize`, `reopened`) |
| Edited workflow YAML from Preview | Author-edited content committed to a branch | Committed only to `devdigest/ci` (never `main`); PR review is the human gate; workflow file marked `editable` intentionally |
| Ingested `CiResultArtifact` | Forged/replayed run, secret smuggling, spoofed repo | `CiResultArtifact.safeParse`; require valid `CI_INGEST_TOKEN`; match commit SHA + repository id to a known installation; dedupe on `(installation, pr, SHA)` |
| PR title / body / branch name / diff (in CI context) | Prompt injection, shell injection | Runner wraps with `wrapUntrusted` + `INJECTION_GUARD` (unchanged); ingest stores as inert data, never executed or interpolated into commands |
| CI ingest bearer token | Credential leakage | Read only via `SecretsProvider`; never logged, echoed, or written to any artifact/trace |

## Open questions

- [ ] **Ingest authenticity mechanism** — confirmed here as a shared `CI_INGEST_TOKEN`
  bearer for the simplest v1. If a stronger channel (HMAC-signed artifact or per-installation
  token) is required before shipping, this needs revisiting.
- [x] **`ci_runs` provenance columns** — RESOLVED: v1 adds nullable `commit_sha`, `model`,
  and `manifest_version` columns to `ci_runs` via a new migration (AC-E10); ingest populates
  them (AC-E6).
- [x] **Ingest reachability from GitHub-hosted runners** — RESOLVED: v1 generates the
  `POST /ci/ingest` call in the workflow and implements the endpoint, but defers the live
  end-to-end round-trip (self-hosted runner / tunnel / hosted ingest) to a later iteration.
  The `CI_INGEST_TOKEN` provisioning into the target repo follows once reachability is wired.
- [ ] **`memory.jsonl` source of truth** — confirm which table/store the agent's memory is
  read from when present (no memory module is registered in `server/src/modules/index.ts`).
- [ ] **`ci_runs` retention** — unbounded for v1; confirm whether a cap/cleanup is needed
  before the CI Runs table grows large.
- [ ] **Eval Pipeline boundary** — confirmed separate/complementary here; verify no future
  need to correlate a CI run with an eval batch on the shared `agent_runs` table.
