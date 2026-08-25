# Implementation Plan: Export to CI

**Spec:** `specs/export-to-ci/export-to-ci.spec.md` (`ExportToCi_1`)
**Scope:** server (`@devdigest/api`), client (`@devdigest/web`). `agent-runner` and `reviewer-core` are consumed unchanged.
**Estimated complexity:** high
**Multi-agent execution:** no — single linear track (server first, then client, since client depends on the routes existing).
**Created:** 2026-08-25

## Context

Tuned review agents live only in the studio DB and cannot guard real PRs in a
target repo's CI. Export to CI serializes an agent to a portable
`AgentManifest` YAML at `.devdigest/agents/<slug>.yaml`, bundles the already-built
`agent-runner` and a least-privilege GitHub Actions workflow, and opens a
`devdigest/ci` PR (or returns files for a zip). Studio and runner validate the
manifest with the **same** Zod schema (`AgentManifest` in
`server/src/vendor/shared/contracts/eval-ci.ts`) so configuration never drifts.
Ingested runs record provenance (manifest version, model, commit SHA) and surface
on a CI Runs page and a per-agent CI tab.

This is a deliberately simple v1 that REUSES existing scaffolding: the `eval-ci.ts`
contracts, the `ci_installations` / `ci_runs` tables, `agent_runs.source`, the
Octokit `commitFiles` / `openPullRequest` / `findOpenPr` client, the bundled
runner, and the client `Modal` / `ExportWizardSteps` primitives.

### Key research findings (verified in code)

- **`yaml` is NOT a `server` dependency** (`server/package.json`), though it is used by
  `agent-runner`. It must be added to `server` deps to emit the manifest YAML.
- **`SecretKey`** (`server/src/vendor/shared/adapters.ts`) is an open union
  `... | (string & {})`, so `CI_INGEST_TOKEN` is a valid key WITHOUT editing the
  extend-only contract. Read it via `container.secrets.get('CI_INGEST_TOKEN')`,
  which already falls back to `process.env.CI_INGEST_TOKEN` (`LocalSecretsProvider`).
- **No 401 error class exists** (`server/src/platform/errors.ts` has 404/422/502/500
  only). Ingest throws `new AppError('unauthorized', msg, 401)` directly.
- **The `skills` table has no `slug` column** (`server/src/db/schema/skills.ts`, only
  `name`). The manifest `skills` are slugs mapping to `.devdigest/skills/<slug>.md`;
  derive the slug by slugifying `skill.name` in `helpers.ts` and use the SAME slug for
  both the manifest entry and the emitted skill file so the runner's `loadSkillBodies`
  resolves them.
- **Runner env/path contract** (from `agent-runner/src/index.ts`, `context.ts`, `run.ts`):
  env `DEVDIGEST_POST_AS`, `DEVDIGEST_DIR`, `DEVDIGEST_RESULT_PATH`,
  `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `PR_NUMBER`; runner
  entry `.devdigest/runner/index.js`; manifest `.devdigest/agents/<slug>.yaml`;
  skills `.devdigest/skills/<slug>.md`; artifact `devdigest-result.json`.
- **`commitFiles`** (`octokit.ts`) is atomic and forks from `base` when the branch is
  missing, layering onto the base tree (unrelated files preserved) — satisfies the
  "overwrite on `devdigest/ci`, never touch `main`" requirement directly.
- **`api.ts`** exposes `api.get/post`; body-less/JSON handling is automatic. The zip is
  built client-side from the `files` returned by the export response (no server zip).

## Requirements Summary

Implements all EARS criteria in the spec:
- Ubiquitous AC-U1..U8 (module registration, workspace scoping, manifest YAML,
  workflow permissions/secret handling/pinned SHAs, installation persistence, `CiFile.editable`).
- Event-Driven AC-E1..E10 (wizard open/preview/edited-YAML — Step 11; open_pr/zip — Step 5; ingest insert+upsert — Steps 7/8; provenance migration — Steps 1/2; CI Runs query — Step 13; CI tab query + workflow version — Step 12; re-export reuse — Step 5).
- State-Driven AC-ST1..ST3 (GHA-only target, in-flight disable, auto-refresh).
- Optional AC-O1..O3 (memory omit/include, `reopened` trigger, publish `none`).
- Unwanted AC-UN1..UN7 (401 no token, 400/422 bad artifact, commit/PR failure, overwrite,
  fork guard, dedupe, manifest validation abort).

## Spec Coverage Matrix

| Criterion | EARS Pattern | Plan Step(s) | Status |
|-----------|-------------|--------------|--------|
| AC-U1: register `ci` module in `modules/index.ts` | Ubiquitous | Step 3, Step 9 | COVERED |
| AC-U2: scope routes via `getContext` (except ingest) | Ubiquitous | Step 4, Step 7 | COVERED |
| AC-U3: manifest YAML validated vs `AgentManifest` before write | Ubiquitous | Step 5 | COVERED |
| AC-U4: workflow `permissions` = contents:read + pull-requests:write | Ubiquitous | Step 6 | COVERED |
| AC-U5: `OPENROUTER_API_KEY` only via `${{ secrets.* }}`, never persisted | Ubiquitous | Step 5, Step 6 | COVERED |
| AC-U6: external actions pinned to SHA; `review-action@v1` commented | Ubiquitous | Step 6 | COVERED |
| AC-U7: persist `ci_installations` row per successful export | Ubiquitous | Step 5 | COVERED |
| AC-U8: workflow `editable:true`; manifest/skills/memory/runner `editable:false` | Ubiquitous | Step 5 | COVERED |
| AC-E1: Add to CI → wizard step 1 (Target), GHA preselected | Event-Driven | Step 11 | COVERED |
| AC-E2: Preview renders manifest/skills/memory/workflow | Event-Driven | Step 11 | COVERED |
| AC-E3: edited workflow YAML flows through unchanged | Event-Driven | Step 4, Step 11 | COVERED |
| AC-E4: Install open_pr → commitFiles + openPullRequest → CiExport | Event-Driven | Step 5 | COVERED |
| AC-E5: zip (files) → pr_url:null; client builds zip | Event-Driven | Step 5, Step 11 | COVERED |
| AC-E6: ingest inserts agent_runs(source=ci) + upserts ci_runs w/ provenance | Event-Driven | Step 7, Step 8 | COVERED |
| AC-E7: CI Runs page calls GET /ci/runs w/ filters, renders columns | Event-Driven | Step 13, Step 14 | COVERED |
| AC-E8: agent CI tab calls GET /ci/installations, renders history + fail-on | Event-Driven | Step 12 | COVERED |
| AC-E9: Update CI config reuses findOpenPr for existing PR | Event-Driven | Step 5 | COVERED |
| AC-E10: migration adds nullable commit_sha/model/manifest_version to ci_runs | Event-Driven | Step 1, Step 2 | COVERED |
| AC-ST1: Target step GHA-only; others disabled | State-Driven | Step 11 | COVERED |
| AC-ST2: in-flight → disable Install/Continue, pending state | State-Driven | Step 11 | COVERED |
| AC-ST3: CI Runs auto-refresh via refetchInterval | State-Driven | Step 13, Step 14 | COVERED |
| AC-O1: include memory.jsonl when present; omit entirely otherwise | Optional | Step 5, Step 11 (deferred present-branch) | COVERED |
| AC-O2: `reopened` in triggers → emit in types list; else opened+synchronize | Optional | Step 6 | COVERED |
| AC-O3: publish `none` → run + upload artifact, DEVDIGEST_POST_AS=none | Optional | Step 6 | COVERED |
| AC-UN1: ingest w/o valid CI_INGEST_TOKEN → 401, nothing persisted | Unwanted | Step 7 | COVERED |
| AC-UN2: bad CiResultArtifact or unknown repo/SHA → 400/422, nothing persisted | Unwanted | Step 7, Step 8 | COVERED |
| AC-UN3: commitFiles/openPullRequest fails → surface error, no installation row | Unwanted | Step 5 | COVERED |
| AC-UN4: existing workflow file → overwrite on devdigest/ci, main untouched | Unwanted | Step 5 | COVERED |
| AC-UN5: fork PR → job `if` guard, no secrets, no pull_request_target+untrusted checkout | Unwanted | Step 6 | COVERED |
| AC-UN6: duplicate (installation, pr, SHA) → update existing ci_runs | Unwanted | Step 8 | COVERED |
| AC-UN7: slug unresolved or manifest invalid → abort, no PR/files | Unwanted | Step 5 | COVERED |

No GAP rows remain. AC-O1's "present" branch is wired but intentionally never emits in
v1 (no memory store exists) — see Risks and the still-open spec question.

**Step order for client work:** Step 11 (Export Wizard) → Step 12 (CI tab, depends on wizard) → Step 13 (CI Runs page, independent of wizard/tab) → Step 14 (i18n). The wizard is implemented first so the CI tab can import and reference it without a forward-dependency.

## Recommendations Applied

- **Reuse `yaml` (not a hand-rolled emitter)** for manifest serialization so studio and
  runner agree on the manifest shape; add it to `server` deps (verified absent).
- **`CI_INGEST_TOKEN` via `SecretsProvider`** with no contract edit — the open `SecretKey`
  union already accepts it and the local provider already falls back to `process.env`.
- **Derive skill slugs by slugifying `skill.name`** (no slug column exists) and use the
  same slug for the manifest entry and the emitted `.md` filename so the runner resolves them.
- **Build the zip client-side** from the returned `CiFile[]` — keeps the server response a
  plain JSON `CiExport` and avoids a binary streaming path.
- **memory.jsonl deferred honestly**: wire the `CiFile` slot + a Preview "no memory" row,
  but never emit the file in v1 (satisfies AC-O1 omit branch; the present branch lands with a
  real memory source). Keep the spec's `memory.jsonl source of truth` open question open.

## Architecture Constraints

- `server/src/vendor/shared/` is extend-only — reuse `eval-ci.ts` contracts as-is; add
  new request/response schemas only in NEW files if needed. Source: root `CLAUDE.md` "Do not touch", `server/CLAUDE.md`.
- Modules are registered statically in `server/src/modules/index.ts` (one import + one entry). Source: `server/CLAUDE.md` Conventions.
- Every route calls `getContext(container, req)` first — EXCEPT `POST /ci/ingest`, which
  authenticates via `CI_INGEST_TOKEN`. Source: `server/CLAUDE.md`, spec AC-U2/AC-S1.
- Secrets only through `SecretsProvider`, never DB/config/git. Source: root `CLAUDE.md`.
- Migrations are NOT applied on boot — plan includes `pnpm db:generate` + `pnpm db:migrate`. Source: root `CLAUDE.md` Gotchas.
- Do NOT modify `agent-runner/src/*` or `reviewer-core` (grounding gate, `INJECTION_GUARD`). Source: `agent-runner/CLAUDE.md`, root `CLAUDE.md`.
- `agent_runs` shared with the Eval Pipeline spec but never the same rows (local vs ci `source`). Source: spec Non-goals.
- Client: pages are thin; logic lives in colocated `_components/`; data via `lib/hooks/`; vendor is read-only, inject nav via `patch-nav.ts` side-effect. Source: `client/CLAUDE.md`.
- Integration tests use `*.it.test.ts`; everything else is unit. Source: root `CLAUDE.md`.

## Pre-implementation Checklist

- [x] Migration needed? **yes** — one migration (Step 1/2) adds: nullable `commit_sha`, `model`, `manifest_version` on `ci_runs`; and nullable `agent_version` on `ci_installations`.
- [x] New module needed? **yes** — `server/src/modules/ci/`; register in `modules/index.ts` (Step 3/9).
- [x] New shared contracts needed? **no new files required** — reuse `eval-ci.ts`. Any route-local request schemas (e.g. ingest body extras) live in `modules/ci/routes.ts`, not in `vendor/shared/`.
- [x] New adapter needed? **no** — reuse Octokit client (`commitFiles`/`openPullRequest`/`findOpenPr`) and `SecretsProvider`.
- [x] New dependency needed? **yes** — two additions:
  - `yaml` → `server/package.json` (Step 5, manifest serialization; verified absent).
  - `fflate` → `client/package.json` (Step 11, zip download; verified absent). Tree-shake to `zipSync` + `strToU8` only (~4–5 kB gzipped). `pnpm add fflate` in `client/`.

---

## Steps

### Step 1: Add provenance columns to `ci_runs` schema

**Package:** server
**Files:** `server/src/db/schema/ci.ts` (modify)
**What:** Two schema changes in one migration file:
1. Add three NULLABLE columns to the `ciRuns` table: `commitSha` (`text('commit_sha')`), `model` (`text('model')`), `manifestVersion` (`text('manifest_version')`). Populated by ingest (Step 8).
2. Add one NULLABLE column to the `ciInstallations` table: `agentVersion` (`integer('agent_version')`). Populated by the export service (Step 5) with `agent.version` at export time, so the CI tab can show the *installed* workflow version rather than the current one.
Do NOT alter or reorder any existing column. All new columns are nullable so existing rows remain valid.
**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`
**Tests:** none for the schema file itself; verified via the migration + ingest + export integration tests (Steps 8, 9).
**Depends on:** none
**Addresses:** AC-E10, AC-E8 (workflow version display)

### Step 2: Generate + document the migration

**Package:** server
**Files:** `server/src/db/migrations/00XX_*.sql` + `meta/_journal.json` + `meta/00XX_snapshot.json` (created by drizzle-kit)
**What:** Run `cd server && pnpm db:generate` to produce the next migration. Confirm the generated SQL contains:
- Three `ALTER TABLE "ci_runs" ADD COLUMN ...` statements (nullable `commit_sha text`, `model text`, `manifest_version text`).
- One `ALTER TABLE "ci_installations" ADD COLUMN agent_version integer` statement (nullable).
- No NOT NULL constraints or defaults that would rewrite either table.
Do NOT hand-write the SQL — let drizzle-kit keep the journal/meta consistent (current head is `0017`; next is `0018`).
**Skills:** `drizzle-orm-patterns`
**Tests:** `cd server && pnpm db:migrate` against a running Postgres (see Verification) — must apply cleanly and be idempotent.
**Depends on:** Step 1
**Addresses:** AC-E10

### Step 3: Scaffold the `ci` module folder

**Package:** server
**Files:** `server/src/modules/ci/routes.ts`, `service.ts`, `repository.ts`, `helpers.ts`, `constants.ts`, `workflow.ts` (all create)
**What:** Create the module skeleton following the `agents` module template (routes → service → repository, onion layering). `routes.ts` default-exports a Fastify plugin using `app.withTypeProvider<ZodTypeProvider>()` and constructs `new CiService(app.container)`. `constants.ts` holds fixed paths/strings: `CI_BRANCH='devdigest/ci'`, `WORKFLOW_PATH='.github/workflows/devdigest-review.yml'`, `MANIFEST_DIR='.devdigest/agents'`, `SKILLS_DIR='.devdigest/skills'`, `RUNNER_PATH='.devdigest/runner/index.js'`, `MEMORY_PATH='.devdigest/memory.jsonl'`, `RESULT_FILE='devdigest-result.json'`, the pinned action SHAs, and the `CI_INGEST_TOKEN` secret key name.
**Skills:** `fastify-best-practices`, `typescript-expert` (onion-architecture guidance)
**Tests:** compile check via `pnpm typecheck`.
**Depends on:** none
**Addresses:** AC-U1

### Step 4: Define export/ingest request schemas + `ci` repository

**Package:** server
**Files:** `server/src/modules/ci/routes.ts` (route-local Zod), `server/src/modules/ci/repository.ts` (modify)
**What:**
- Reuse `CiExportInput` from `@devdigest/shared` for the export body. Add a route-local wrapper allowing the wizard's **edited workflow YAML** to pass through unchanged (e.g. `ExportBody = CiExportInput.extend({ workflow_override: z.string().nullish() })`) — the service uses `workflow_override` verbatim when present (AC-E3). Validate `repo` as `owner/name` (regex `^[^/\s]+\/[^/\s]+$`); triggers constrained to the fixed allow-list `['opened','synchronize','reopened']` in the generator (Step 6), not trusted raw.
- Repository methods: `insertInstallation({agentId, repo, targetType})`, `listInstallations(agentId)`, `findInstallationByRepo(repo)` (for ingest match), `listRuns(filters)` (join `ci_runs`→`ci_installations`→`agents` for repo/agent/source columns), `insertAgentRun(...)` (source='ci', workspace-scoped), and `upsertCiRun(...)` (Step 8). All queries workspace-scoped where a workspace is in context; ingest match is by repo string + installation id.
**Skills:** `zod`, `drizzle-orm-patterns`, `fastify-best-practices`
**Tests:** unit test the `repo`/trigger validation and DTO mapping in `ci.helpers.test.ts` (Step 5 helpers) — no DB.
**Depends on:** Step 3
**Addresses:** AC-E3, AC-U2

### Step 5: Implement export service — bundle build + PR/zip

**Package:** server
**Files:** `server/src/modules/ci/service.ts` (modify), `server/src/modules/ci/helpers.ts` (modify), `server/package.json` (modify — add `yaml`)
**What:** Add `yaml` to `server` dependencies (verified absent). Implement `CiService.exportCi(workspaceId, agentId, input)`:
1. Load the agent (`container.agentsRepo.getById(workspaceId, agentId)`) and its linked skills (`linkedSkills`). If missing → throw `NotFoundError` (AC-UN7).
2. Build the `AgentManifest` object from the agent config (`name`, `provider`, `model`, `system_prompt`, `skills` = slugified skill names, `strategy`, `ci_fail_on`) and **`AgentManifest.parse(...)`** it BEFORE serializing; on failure abort with a descriptive error and write nothing (AC-UN7, AC-U3).
3. Serialize with `yaml.stringify(manifest)` → `CiFile` at `.devdigest/agents/<slug>.yaml`, `editable:false`. Emit each skill body as `.devdigest/skills/<slug>.md`, `editable:false` (slug matches the manifest entry). Emit the bundled runner: read `agent-runner/dist/index.js` and emit at `.devdigest/runner/index.js`, `editable:false`. Emit the workflow via `generateWorkflow(...)` (Step 6) at `WORKFLOW_PATH`, `editable:true` — UNLESS `input.workflow_override` is set, in which case use it verbatim (AC-E3, AC-U8).
4. **memory.jsonl**: v1 has no memory source → never push the `CiFile` (AC-O1 omit branch). Leave a clearly-commented seam where the memory `CiFile` would be appended when a source lands.
5. Never place `OPENROUTER_API_KEY` (or any secret) into the manifest, skill files, or workflow (AC-U5).
6. If `action==='open_pr'`: resolve `github = await container.github()`; `commitFiles(repo, { branch: CI_BRANCH, base: input.base, files, message })` then `openPullRequest(repo, { title, head: CI_BRANCH, base: input.base, body })`. Before opening, call `findOpenPr(repo, CI_BRANCH)`; if a PR already exists, skip `openPullRequest` and return its URL (AC-E9). `commitFiles` is atomic from `base` and layers onto the base tree — this overwrites an existing workflow on `devdigest/ci` and never touches `main` (AC-UN4). On any GitHub failure, let the error propagate and DO NOT insert an installation row (AC-UN3).
7. **Slug collision guard**: after computing all skill slugs via `slugify(skill.name)`, check for duplicate slugs with a `Set`. If any two skills produce the same slug, abort immediately with a descriptive error (same abort path as AC-UN7) — never silently overwrite a skill file.
8. Only AFTER a successful commit/PR (or for `action==='files'`), `insertInstallation({agentId, repo, targetType:'gha', agentVersion: agent.version})` (AC-U7, AC-E8) and return `CiExport { installation, files, pr_url }` (pr_url null for `files`, AC-E4/AC-E5). Storing `agent.version` at insert time means the CI tab shows the version *at installation*, not the current one.
   - `helpers.ts`: `slugify(name)`, `assertNoDuplicateSlugs(slugs)` (throws on collision), `manifestFromAgent(agent, skillSlugs)`, `bundleFiles(...)`, `readRunnerBundle()` (reads `agent-runner/dist/index.js` via an absolute path from the server root; error if the bundle is missing so export fails loudly).
**Skills:** `fastify-best-practices`, `zod`, `security`, `typescript-expert`
**Tests:** `server/src/modules/ci/service.test.ts` (unit) with `ContainerOverrides.github` mock (`adapters/mocks.ts`): asserts manifest YAML parses back to the same `AgentManifest`; asserts no secret string appears in any emitted file; asserts `commitFiles`+`openPullRequest` args (branch `devdigest/ci`, base); asserts `findOpenPr` reuse path; asserts invalid manifest aborts before any GitHub call.
**Depends on:** Step 4, Step 6
**Addresses:** AC-U3, AC-U5, AC-U7, AC-U8, AC-E4, AC-E5, AC-E9, AC-UN3, AC-UN4, AC-UN7, AC-O1

### Step 6: Implement the GitHub Actions workflow generator

**Package:** server
**Files:** `server/src/modules/ci/workflow.ts` (modify)
**What:** `generateWorkflow({ triggers, postAs, base })` returns the `.github/workflows/devdigest-review.yml` string with EXACTLY this security shape:
- `on: pull_request:` with `types:` emitted from a FIXED allow-list intersected with `input.triggers`: always `opened`, `synchronize`; add `reopened` only when present (AC-O2). Never interpolate raw trigger strings.
- `permissions:` block set to EXACTLY `contents: read` and `pull-requests: write` (all others default to `none`) (AC-U4).
- A single job with a job-level `if` guard that skips fork PRs: `if: ${{ github.event.pull_request.head.repo.fork == false }}`. Do NOT use `pull_request_target`; use the default `pull_request` event with `actions/checkout` of the PR merge ref (no untrusted-code-with-secrets path) (AC-UN5).
- Steps: `actions/checkout@<full-SHA>` and `actions/setup-node@<full-SHA>`, both PINNED to full commit SHAs stored as constants in `constants.ts` (AC-U6). A COMMENTED placeholder line `# uses: devdigest/review-action@v1` (AC-U6). The review step runs the in-repo runner: `node .devdigest/runner/index.js` (AC-U6).
  - **SHA lookup at implementation time**: the implementor must resolve the current stable SHA for each action (e.g. `actions/checkout@v4` → its `HEAD` SHA) at the time of writing — SHA values change with action releases. Look up via the action's GitHub releases page or `gh api repos/actions/checkout/git/ref/heads/main`. Store as named constants, not inline strings, so future updates are a one-line change.
- `env:` for the runner step: `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}` (ONLY reference; never the value — AC-U5), `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `GITHUB_REPOSITORY: ${{ github.repository }}`, `PR_NUMBER: ${{ github.event.pull_request.number }}`, `DEVDIGEST_POST_AS: <postAs>` (literal from input; `none` posts nothing — AC-O3), `DEVDIGEST_RESULT_PATH` default. These names/paths MUST match `agent-runner/src/context.ts` + `index.ts`.
- An `actions/upload-artifact@<full-SHA>` step uploading `devdigest-result.json` (runs even when `post_as=none` so ingest still has the artifact — AC-O3). Include the `POST /ci/ingest` call as a documented step (the live round-trip is out of scope, but the call must be present per spec).
- Build the YAML with the `yaml` package (or a controlled template) — never string-concatenate untrusted input into keys.
**Skills:** `security`, `typescript-expert`
**Tests:** `server/src/modules/ci/workflow.test.ts` (unit): assert exact `permissions` map; assert `OPENROUTER_API_KEY` appears only as `${{ secrets.OPENROUTER_API_KEY }}`; assert fork `if` guard present and no `pull_request_target`; assert every `uses:` (except the commented placeholder) is pinned to a 40-char SHA; assert `reopened` present/absent per input; assert `DEVDIGEST_POST_AS` reflects input.
**Depends on:** Step 3
**Addresses:** AC-U4, AC-U5, AC-U6, AC-UN5, AC-O2, AC-O3

### Step 7: Implement `POST /ci/ingest` route + auth

**Package:** server
**Files:** `server/src/modules/ci/routes.ts` (modify), `server/src/modules/ci/service.ts` (modify)
**What:** Register `POST /ci/ingest` as the ONLY route in this module that does NOT call `getContext`. Validation order (fail-closed, persist nothing until all pass):
1. **Token**: read the `Authorization: Bearer <token>` header; compare against `await container.secrets.get('CI_INGEST_TOKEN')`. Missing/mismatch → throw `new AppError('unauthorized', 'Invalid CI ingest token', 401)` (no 401 class exists) and write nothing (AC-UN1). Use a constant-time-ish compare; never log the token.
2. **Schema**: `CiResultArtifact.safeParse(req.body)`; failure → `ValidationError` (422) (AC-UN2). Also require `repository` and `commit_sha` in the ingest body (route-local schema fields alongside the artifact, since `CiResultArtifact` itself has no repo/SHA) and validate their shapes.
3. **Match**: `findInstallationByRepo(repository)`; if none, or the installation is unknown, → 400/422, persist nothing (AC-UN2).
4. Delegate to `service.ingest(...)` (Step 8) for the transactional write.
Treat all artifact string fields (agent, pr title/body if present) as inert data — store, never interpolate into commands (spec Untrusted inputs row).
**Skills:** `fastify-best-practices`, `security`, `zod`
**Tests:** integration `server/src/modules/ci/ci.it.test.ts` via `app.inject()`: 401 on missing/wrong token with zero DB writes; 422 on malformed artifact; 400/422 on unknown repo/SHA.
**Depends on:** Step 4
**Addresses:** AC-U2, AC-UN1, AC-UN2

### Step 8: Implement ingest persistence (agent_runs + ci_runs upsert)

**Package:** server
**Files:** `server/src/modules/ci/service.ts` (modify), `server/src/modules/ci/repository.ts` (modify)
**What:** `CiService.ingest({ artifact, repository, commitSha, installation })`:
1. Insert one `agent_runs` row with `source='ci'`, populating `model`, `provider`, `durationMs`, `costUsd`, `status`, `findingsCount` from the artifact where available; workspace derived from the installation's agent (AC-E6).
2. **Upsert** `ci_runs` keyed on `(ci_installation_id, pr_number, commit_sha)` — a duplicate replay UPDATEs the existing row rather than inserting (AC-UN6). Record provenance `commit_sha`, `model`, `manifest_version` (from artifact `version`) on the row. Because `ci_runs` has no unique constraint on that triple today, implement the upsert as a repository method that does a scoped `SELECT ... FOR UPDATE` (or `findByKey` then update-or-insert) INSIDE a `db.transaction(...)` to avoid a TOCTOU double-insert under concurrent replays. (A DB-level partial unique index is the more robust option; note it as a follow-up but v1 uses the transactional path to stay within the "extend-only, one migration" constraint.)
**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`, `security`
**Tests:** integration `ci.it.test.ts`: valid artifact inserts exactly one `agent_runs` (source='ci') + one `ci_runs` with provenance; replaying the same `(installation, pr, SHA)` updates (not duplicates) the `ci_runs` row and does not create a second row.
**Depends on:** Step 1, Step 2, Step 7
**Addresses:** AC-E6, AC-UN6

### Step 9: Register the `ci` module + read routes (`GET /ci/runs`, `GET /ci/installations`)

**Package:** server
**Files:** `server/src/modules/index.ts` (modify), `server/src/modules/ci/routes.ts` (modify), `server/src/modules/ci/service.ts` (modify)
**What:**
- Add `import ci from './ci/routes.js';` and one `ci,` entry to the `modules` registry (AC-U1).
- `GET /ci/runs`: `getContext` first; accept optional query filters (repo, agent, source, status) via a route-local Zod query schema; return `CiRun[]` (shape from `@devdigest/shared`) mapping `duration_s` from `duration_ms/1000`, plus `agent` name and `github_url` (AC-E7).
- `GET /ci/installations`: `getContext` first; optional `agent_id` query to scope to one agent; return `CiInstallation[]` including the `agent_version` field (as `agentVersion` in the DTO — the version at install time, from the new column added in Step 1) for the CI tab to display as "Installed workflow version" (AC-E8).
- Also add `POST /agents/:id/export-ci` here (params `IdParams`, body = the Step 4 `ExportBody`), delegating to `service.exportCi(workspaceId, id, body)` — this is the wizard's Install endpoint.
**Skills:** `fastify-best-practices`, `zod`
**Tests:** integration `ci.it.test.ts`: `GET /ci/runs` and `GET /ci/installations` return workspace-scoped rows; `POST /agents/:id/export-ci` with the github mock returns a `CiExport`.
**Depends on:** Step 5, Step 8
**Addresses:** AC-U1, AC-E7, AC-E8

### Step 10: Client CI data hooks

**Package:** client
**Files:** `client/src/lib/hooks/ci.ts` (create), `client/src/lib/hooks/index.ts` (modify if a barrel exists)
**What:** TanStack Query hooks (business-logic layer; components never call `api` directly):
- `useCiRuns(filters)` → `api.get<CiRun[]>('/ci/runs?...')` with `refetchInterval` = a module constant `CI_RUNS_POLL_MS` (20_000, within the spec's 15–30s) for AC-ST3.
- `useCiInstallations(agentId)` → `api.get<CiInstallation[]>('/ci/installations?agent_id=...')`, `enabled: !!agentId`.
- `useExportCi()` mutation → `api.post<CiExport>('/agents/${id}/export-ci', body)`; on success invalidate `['ci-installations', agentId]` and `['ci-runs']`.
Import contract types from `@devdigest/shared` (`CiRun`, `CiInstallation`, `CiExport`, `CiExportInputBody`).
**Skills:** `react-frontend-best-practices`, `typescript-expert`
**Tests:** covered indirectly by component tests (Steps 11, 12, 13).
**Depends on:** Step 9
**Addresses:** AC-E7, AC-E8, AC-ST3

### Step 12: Add the agent CI tab

**Package:** client
**Files:** `client/src/app/agents/[id]/page.tsx` (modify), `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (modify), `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` (modify), `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/` (create: `CiTab.tsx`, `index.ts`, `constants.ts`)
**What:**
- Add `"ci"` to `VALID_TABS` in `page.tsx`.
- Add a `TABS` entry `{ key: "ci", labelKey: "editor.tabs.ci", icon: "Rocket" }` (icon verified to exist) in `constants.ts`, and render `{tab === "ci" && <CiTab agent={agent} />}` in `AgentEditor.tsx`.
- `CiTab` renders installations (including `agentVersion` from the installation row as "Installed workflow version" — this is the agent version *at install time*, stored in Step 5), run history, and the `ci_fail_on` ("Fail CI on") setting via `useCiInstallations(agent.id)` + a filtered `useCiRuns({ agent })`; shows an **Add to CI** button that opens the Export Wizard modal (Step 11) (AC-E1, AC-E8). Handle loading/error/empty states.
**Skills:** `react-best-practices`, `react-frontend-best-practices`, `next-best-practices`
**Tests:** `CiTab.test.tsx` (React Testing Library, jsdom): renders installations/run-history from mocked hooks; displays `agentVersion` as workflow version; Add to CI opens the wizard.
**Depends on:** Step 10, Step 11
**Addresses:** AC-E8, AC-E1

### Step 13: Add the CI Runs navigation page

**Package:** client
**Files:** `client/src/app/ci-runs/page.tsx` (create), `client/src/app/ci-runs/_components/CiRunsTable/` (create), `client/src/app/ci-runs/_components/FilterBar/` (create), `client/src/app/ci-runs/constants.ts` (create), `client/src/components/app-shell/patch-nav.ts` (modify)
**What:**
- Thin page orchestrator (mirrors `repos/[repoId]/pulls/page.tsx`): resolve filters from `?repo&agent&source&status`, call `useCiRuns(filters)`, render `FilterBar` + `CiRunsTable` with loading/error/empty states. Columns: repository, PR, agent, source, duration, findings, cost, status, trace/job link (AC-E7). The spec uses the word "verdict" informally; the `CiRunStatus` enum values (`succeeded`, `failed`, `no_findings`, `running`) and the `ci_runs.status` column are the authoritative names — use "Status" as the column header, consistent with the design mockup and the DB schema. Auto-refresh comes from the hook's `refetchInterval` (AC-ST3).
- `patch-nav.ts`: push a `CI_RUNS_ITEM` (`{ key: "ci-runs", label: "CI Runs", icon: "Rocket", href: "/ci-runs", gKey: "c" }`) into the "SKILLS LAB" section, guarded against duplicates (same pattern as the existing `EVAL_ITEM`). Verify the `gKey` does not collide with existing items.
**Skills:** `react-frontend-best-practices`, `react-best-practices`, `next-best-practices`
**Tests:** `CiRunsTable.test.tsx`: renders rows from mocked `useCiRuns`; filter change updates query.
**Depends on:** Step 10
**Addresses:** AC-E7, AC-ST3

### Step 11: Build the 4-step Export Wizard

**Package:** client
**Files:** `client/src/components/CiExportWizard/` (create: `CiExportWizard.tsx`, `index.ts`, `constants.ts`, `helpers.ts`, `CiExportWizard.test.tsx`)
**What:** A modal wizard (uses `@devdigest/ui` `Modal` + `ExportWizardSteps` with labels `["Target","Preview","Configure","Install"]`) shared by the CI tab. Steps:
1. **Target**: GitHub Actions preselected and the only selectable card; CircleCI/Jenkins/Generic CLI rendered disabled/non-selectable (AC-ST1, AC-E1).
2. **Preview**: render the manifest, resolved skills, the memory row (v1 always shows a "No memory data" row since none is emitted — AC-O1), and the editable workflow YAML in a textarea; edits are held in local state and passed as `workflow_override` on Install (AC-E2, AC-E3). To preview server-generated content without committing, call export with `action:'files'` (or a preview flag) and render the returned `files`.
3. **Configure**: choose triggers (`opened`, `synchronize`, optional `reopened`) and publish mode (`github_review` | `pr_comment` | `none`) → maps to `CiExportInput.triggers` / `post_as` (user story, AC-O2/O3).
4. **Install**: choose `open_pr` (primary) or zip (`files`). On submit call `useExportCi()`. While pending, disable the Install/Continue control and show a pending state (AC-ST2). On `open_pr` success show the `pr_url`; on `files` build a zip client-side from the returned `CiFile[]` and trigger a download (AC-E4, AC-E5). Surface any export error inline in the wizard (AC-UN3).
   - `helpers.ts`: `buildZip(files: CiFile[])` uses **`fflate`** (`pnpm add fflate` in `client/`; verified absent). Import only `zipSync` and `strToU8` — Next.js 15's bundler tree-shakes the rest (~4–5 kB gzipped). Implementation:
     ```ts
     import { zipSync, strToU8 } from 'fflate';
     const entries = Object.fromEntries(
       files.map(f => [f.path, typeof f.contents === 'string' ? strToU8(f.contents) : f.contents])
     );
     const zipped = zipSync(entries, { level: 6 });
     const blob = new Blob([zipped], { type: 'application/zip' });
     // trigger download via URL.createObjectURL(blob)
     ```
     `client-zip` was ruled out (store-only, no compression — the ~1 MB runner bundle would land the download at ~1.5 MB). `jszip` ruled out (abandoned 2022, ~27 kB gzipped). Native `CompressionStream` cannot produce a ZIP container. `filesFromExport(export)` is a simple mapper.
**Skills:** `react-best-practices`, `react-frontend-best-practices`, `security` (untrusted YAML is author-owned, committed only to `devdigest/ci`)
**Tests:** `CiExportWizard.test.tsx`: step navigation; GHA-only target; edited YAML passed as `workflow_override`; pending disables Install; zip vs PR branch.
**Depends on:** Step 10
**Addresses:** AC-E1, AC-E2, AC-E3, AC-E4, AC-E5, AC-ST1, AC-ST2, AC-O1, AC-O2, AC-O3

### Step 14: Wire i18n labels + final integration

**Package:** client
**Files:** client i18n message files (modify — add `agents.editor.tabs.ci`, `ci-runs.*` keys), `client/src/app/ci-runs/constants.ts` (COLUMN_KEYS, SKELETON_ROWS, poll constant)
**What:** Add the translation keys used by the CI tab, CI Runs page columns/empty/error states, and the wizard, matching the existing `next-intl` namespace pattern. Confirm the CI Runs auto-refresh interval constant lives in one place and is within 15–30s.
**Skills:** `next-best-practices`, `react-frontend-best-practices`
**Tests:** `cd client && pnpm test` (component suite) + `pnpm typecheck`.
**Depends on:** Step 11, Step 12, Step 13
**Addresses:** AC-E7, AC-E8, AC-ST3

---

## Proactive Skills That Will Fire

- `engineering-insight` — WILL fire (far more than 3 files changed across server + client). Invoke `/engineering-insight` after the server module and again after the client work.
- `breaking-change` — WILL fire: new routes (`/ci/*`, `/agents/:id/export-ci`) and a new module registration change the API surface. No existing contract is broken (additive only).
- `response-schema` — WILL fire: new response shapes (`CiExport`, `CiRun[]`, `CiInstallation[]`) — all already defined in `eval-ci.ts`, so reuse rather than redefine.
- `deprecation-policy` — will NOT fire: nothing removed.
- `semver-discipline` — may fire for the `yaml` dependency addition in `server/package.json`.
- `pr-self-review` (post-commit gate) — MUST be invoked after each commit per root `CLAUDE.md`.

## Risk Assessment

- **memory.jsonl "present" branch is unimplemented** (no memory store/module registered). Mitigation: v1 wires the `CiFile` slot + Preview "no memory" row but never emits the file; AC-O1's omit branch is fully satisfied and the present branch is a clearly-commented seam. Keep the spec's `memory.jsonl source of truth` open question open.
- **Ingest dedupe TOCTOU**: `ci_runs` lacks a unique constraint on `(ci_installation_id, pr_number, commit_sha)`. Two concurrent replays could double-insert. Mitigation: perform the find-or-update inside a `db.transaction` with row locking (Step 8); note a DB partial-unique-index as a hardening follow-up (would need another migration, out of the "one migration" v1 budget).
- **Runner bundle presence**: export reads `agent-runner/dist/index.js`; if the ncc build hasn't run, export must fail loudly (helpers throw), not emit a broken bundle. Mitigation: explicit existence check in `readRunnerBundle()` with a descriptive error.
- **Multi-tenant leakage on ingest**: ingest has no workspace context (token-authed). Mitigation: derive the workspace strictly from the matched installation's agent; never trust a repo/agent field from the artifact for scoping. Reject unknown installations (AC-UN2).
- **Secret leakage into artifacts/logs**: Mitigation: workflow references `OPENROUTER_API_KEY` only via `${{ secrets.* }}`; ingest never logs the bearer token; unit test asserts no secret string in emitted files (Step 5/6 tests).
- **Client zip dependency**: resolved — `fflate` chosen (`pnpm add fflate` in `client/`, verified absent). Tree-shaken to `zipSync` + `strToU8` only (~4–5 kB gzipped). `client-zip` was ruled out (store-only; 1 MB runner bundle uncompressed); `jszip` ruled out (abandoned 2022, 27 kB gzipped); native `CompressionStream` cannot produce a ZIP container.
- **Ingest reachability is out of scope**: the workflow contains the `POST /ci/ingest` call but the GitHub-hosted-runner → local-studio round-trip is deferred (spec Non-goals). Do not attempt tunneling/reachability in v1.

## Out of Scope

- CircleCI / Jenkins / Generic CLI generators (cards inert) — spec Non-goals / AC-ST1.
- Publishing `devdigest/review-action@v1` (commented placeholder only) — spec Non-goals.
- Modifying `agent-runner`, `reviewer-core`, the grounding gate, or `INJECTION_GUARD` — spec Non-goals / Out of scope.
- Editing existing `vendor/shared/` contracts or altering existing `ci_runs` columns (only new nullable columns via one migration) — spec Non-goals.
- Live CI→studio ingest round-trip (self-hosted runner / tunnel / hosted ingest) — spec Non-goals.
- Multi-run service and PR feed — spec Non-goals.
- Automatic re-export on agent edit; secret rotation/management UI; `ci_runs` retention/cleanup — spec Non-goals / Open Questions.

## Verification

1. **Migration**: start Postgres (`./scripts/dev.sh --db-only`), then `cd server && pnpm db:generate` and `cd server && pnpm db:migrate` — applies cleanly; re-running is idempotent; confirm `ci_runs` has nullable `commit_sha`, `model`, `manifest_version` and `ci_installations` has nullable `agent_version`.
2. **Server unit**: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — workflow generator, manifest round-trip, and helper/validation tests pass (no Docker).
3. **Server integration**: `cd server && pnpm exec vitest run .it.test` — ingest 401/422/dedupe and read-route scoping tests pass (needs Docker/Postgres).
4. **Full server**: `cd server && pnpm test` and `cd server && pnpm typecheck`.
5. **Client**: `cd client && pnpm test` and `cd client && pnpm typecheck` — CI tab, CI Runs table, and wizard component tests pass.
6. **Manual end-to-end (wizard → PR)**: with `GITHUB_TOKEN` configured in `~/.devdigest/secrets.json`, open an agent's CI tab → Add to CI → Target (GHA) → Preview (edit the workflow YAML) → Configure (triggers + publish mode) → Install (open_pr). Confirm a `devdigest/ci` PR is opened in the target repo containing `.github/workflows/devdigest-review.yml` (with exact `permissions`, pinned SHAs, fork guard, secret-only `OPENROUTER_API_KEY`), `.devdigest/agents/<slug>.yaml`, `.devdigest/skills/*.md`, and `.devdigest/runner/index.js`, and that `main` is untouched. Re-run Install to confirm `findOpenPr` updates the existing PR rather than opening a duplicate. Then choose the zip option and confirm a client-side download of the same files with `pr_url: null`.
