# Spec: Onboarding Generation

Spec ID: OnboardingGeneration_1
Status: draft
Supersedes: ---

## Problem and User

A new developer joining a project faces a steep ramp-up curve: they must piece
together architecture, critical files, local-run instructions, and reading
priorities from scattered READMEs, wikis, and tribal knowledge. DevDigest already
indexes repositories (symbols, PageRank, file facts) but does not synthesize that
knowledge into a structured onboarding narrative.

The **repository administrator** (or any team member who has added a repo to
DevDigest) needs a one-click way to generate a 5-section guided tour that a new
contributor can read on their first day. The tour must be grounded entirely in
real repository data -- no invented paths, no hallucinated scripts -- and must
degrade gracefully when the repo-intel index is incomplete or absent.

## Goals / Non-goals

### Goals

- Provide a single user-initiated action ("Generate onboarding tour") that
  produces a 5-section structured tour for a repository, powered by an LLM
  call grounded in repo-intel data.
- Store exactly one onboarding document per repository (upsert semantics),
  with metadata (model used, input SHA, generation timestamp).
- Render the tour on a dedicated client page with Mermaid diagram support,
  copy-to-clipboard for shell commands, and "Open on GitHub" links for files.
- Degrade gracefully when repo-intel data is incomplete (no index, empty
  PageRank, missing file facts).
- Support regeneration that fully replaces the previous tour.
- Support sharing via URL copy-to-clipboard.

### Non-goals

- **Dependence on Project Context documents.** Onboarding consumes raw
  repo-intel data (file tree, PageRank, file facts) directly. It does not
  read or depend on Project Context documents from the `context_docs` table.
- **Streaming response.** Generation is a single synchronous LLM call
  (up to 60s). Streaming is deferred to a future iteration.
- **Version history.** Only the latest generation is stored. Historical
  versions are not preserved for v1.
- **Auto-generation on repo add/sync.** Generation is always user-initiated.
- **External issue tracker integration.** The `first_tasks` section is
  synthesized from provided facts, not pulled from GitHub Issues or any
  external source.
- **Table-of-contents / section navigation.** Flagged as a future
  enhancement.

## User stories

- As a repository administrator, I want to generate an onboarding tour for
  my repository so that new contributors have a structured first-day guide.
- As a new contributor, I want to read an architecture overview with a visual
  diagram so that I quickly understand how the system's pieces connect.
- As a new contributor, I want to see the critical files with one-line
  descriptions and "Open" links so that I know where to start reading code.
- As a new contributor, I want numbered shell commands with copy buttons so
  that I can run the project locally without guessing.
- As a new contributor, I want a guided reading path with explanations of why
  each file matters so that I read code in a productive order.
- As a new contributor, I want to see suggested first tasks so that I know
  what kind of contribution is appropriate to start with.
- As a repository administrator, I want to regenerate the tour after
  significant codebase changes so that the onboarding stays current.
- As any user, I want to share the onboarding page URL so that teammates
  can jump directly to the tour.

## Acceptance criteria (EARS)

### Ubiquitous (always true, no trigger)

- AC-U1: The system shall store onboarding data in the `onboarding` table
  with primary key `repo_id` (FK to repos, cascade delete) and columns:
  `json` (jsonb, containing `{ sections: OnboardingSection[] }`), `model`
  (text, not-null, server-default `'deepseek/deepseek-v4-flash'`),
  `input_sha` (text, nullable), and `generated_at` (timestamptz, not-null,
  default now).

- AC-U2: The system shall define a new Zod enum `OnboardingSectionKind` in a
  new contract file `contracts/onboarding.ts` with exactly five members:
  `'architecture'`, `'critical_paths'`, `'run_locally'`, `'reading_path'`,
  `'first_tasks'`. The `OnboardingSection.kind` field in the existing
  `knowledge.ts` contract remains a `z.string()` (extend-only rule); the new
  enum is used for validation in the onboarding module's service layer.

- AC-U3: The `json` column shall store exactly 5 sections, one per canonical
  kind, in the fixed order: `architecture`, `critical_paths`, `run_locally`,
  `reading_path`, `first_tasks`.

- AC-U4: The `diagram` field shall be non-null only for the `architecture`
  section. All other sections shall have `diagram` set to `null`.

- AC-U5: The system shall expose two API endpoints under the repo namespace:
  `GET /repos/:repoId/onboarding` (retrieve the current tour) and
  `POST /repos/:repoId/onboarding` (generate or regenerate the tour).

- AC-U6: The GET endpoint shall return a response shaped as
  `{ sections: OnboardingSection[], model: string, generated_at: string, input_sha: string | null }`.
  If no onboarding exists for the repo, it shall return 404.

- AC-U7: The POST endpoint shall accept an empty body (or an optional
  `{ language?: string }` body defaulting to `"en"`) and return the same
  shape as GET on success.

- AC-U8: The client shall render the onboarding page at route
  `/repos/[repoId]/onboarding`.

- AC-U9: The client shall display section headings using these i18n display
  names:
  - `architecture` = "Architecture Overview"
  - `critical_paths` = "Critical Paths"
  - `run_locally` = "How to Run Locally"
  - `reading_path` = "Guided Reading Path"
  - `first_tasks` = "First Tasks"

- AC-U10: The system shall use semantic HTML for the onboarding page:
  `<main>` landmark, `<h2>` per section, `<ul>` or `<ol>` for lists.
  The Mermaid diagram shall have `aria-label="Architecture diagram"`.
  Copy-button toasts shall use an existing `aria-live="polite"` region.

### Event-Driven (triggered by an event)

- AC-E1: When the user navigates to the onboarding page, the client shall
  issue a GET request. If the response is 200, render the tour. If 404,
  render the empty state with a "Generate onboarding tour" call-to-action.

- AC-E2: When the user clicks "Generate onboarding tour" (empty state) or
  "Regenerate" (existing tour), the client shall issue a POST request and
  display a full-page loading state (spinner + "Generating...") until the
  response arrives.

- AC-E3: When the POST request is received, the server shall gather LLM
  input data: (a) repo map from `getRepoMap()`, (b) file tree from the walk
  pipeline, (c) top-15 files by PageRank with first 100 lines each (simple
  truncation) read from disk, (d) config files (`package.json`, `Makefile`,
  `docker-compose.yml`, `README.md`) for the `run_locally` section, and
  (e) precomputed facts from `fileFacts` (endpoints, crons).

- AC-E4: When the LLM returns a valid response, the server shall parse it
  with Zod, upsert the result into the `onboarding` table (single row per
  repo), and return the response to the client.

- AC-E5: When the user clicks a "Copy" button next to a shell command in
  the `run_locally` section, the system shall copy the command text to the
  clipboard and show a toast confirming "Copied."

- AC-E6: When the user clicks an "Open" button next to a file in the
  `critical_paths` or `reading_path` section, the system shall open the
  GitHub URL `https://github.com/{owner}/{repo}/blob/{defaultBranch}/{path}`
  in a new browser tab.

- AC-E7: When the user clicks the share button, the system shall copy the
  current page URL to the clipboard and show a toast confirming
  "Link copied."

- AC-E8: When the server resolves model selection for the onboarding LLM
  call, it shall use the workspace's `feature_models` override for the
  `'onboarding'` feature ID if configured, falling back to the registry
  default (`deepseek/deepseek-v4-flash`).

### State-Driven (true while a condition holds)

- AC-S1: While a generation request is in progress for a given repo, the
  server shall hold an in-memory per-repo lock. If a GET request arrives
  during generation, the server shall return
  `{ status: 'generating' }` so the client displays the loading state
  instead of the empty-state CTA.

- AC-S2: While the onboarding page is in the loading state (POST in flight
  or `status: 'generating'` from GET), the client shall display a full-page
  spinner with the text "Generating..." and disable the generate/regenerate
  button.

- AC-S3: While no onboarding tour exists for the active repository and no
  generation is in progress, the client shall display an empty state with
  the heading "Generate onboarding tour" and a CTA button.

### Optional Feature (conditional on feature presence)

- AC-O1: Where the onboarding module is registered in
  `server/src/modules/index.ts`, the system shall expose the
  `GET /repos/:repoId/onboarding` and `POST /repos/:repoId/onboarding`
  endpoints.

- AC-O2: Where an onboarding tour has been generated, the "Regenerate"
  button shall replace the empty-state CTA.

### Unwanted Behavior (error/fault handling)

- AC-X1: If the LLM response fails Zod parsing on the first attempt, then
  the system shall retry the LLM call once with the same payload. If the
  second attempt also fails parsing, the system shall return HTTP 500 and
  shall NOT write any data to the database.

- AC-X2: If a second POST request arrives for a repo that already has a
  generation in progress (per-repo lock held), then the system shall return
  HTTP 409 with body `{ error: "Generation already in progress" }`.

- AC-X3: If the repo-intel index is not available (repo not yet indexed),
  then the system shall degrade gracefully: use fallback data consisting of
  the file tree from a fresh clone walk plus root config files
  (`package.json`, `README.md`, `docker-compose.yml`, `Makefile`). The
  `input_sha` shall be stored as `null`. A server-side warning shall be
  logged.

- AC-X4: If `getCriticalPaths()` returns an empty array, then the system
  shall still generate all 5 sections. The LLM shall synthesize
  `reading_path` and `critical_paths` from the file tree and top-N files.
  A server-side warning shall be logged.

- AC-X5: If the LLM call exceeds 60 seconds, then the system shall time
  out the request and return HTTP 504 (or let Fastify's default timeout
  apply). No data shall be written to the database.

- AC-X6: If the Mermaid diagram in the `architecture` section fails to
  render on the client, then the client shall hide the diagram block, render
  only the `body` markdown for that section, and optionally display a note
  "Diagram could not be rendered."

- AC-X7: If the LLM call fails due to a network error or provider outage,
  then the system shall return HTTP 502 with a descriptive error message.
  No data shall be written to the database.

## Edge cases

| # | Scenario | Expected behavior |
|---|----------|-------------------|
| 1 | Repo has never been indexed (no repo-intel data at all) | Server uses fallback data set (file tree + config files). All 5 sections are generated. `input_sha` is null. Server logs a warning. |
| 2 | Repo was indexed but `getCriticalPaths()` returns `[]` | All 5 sections generated. LLM synthesizes critical_paths and reading_path from file tree and top-N files. Server logs warning. |
| 3 | User clicks "Generate" and then navigates away before response | POST continues server-side. On return, GET retrieves the stored result (if generation succeeded) or empty state (if it failed). |
| 4 | Two users click "Generate" simultaneously for the same repo | First request acquires the lock and proceeds. Second request gets HTTP 409. |
| 5 | LLM returns valid JSON but `diagram` is non-null for a non-architecture section | Zod validation (or post-parse normalization) sets `diagram` to null for non-architecture sections. |
| 6 | LLM returns a Mermaid diagram with syntax errors | Client-side Mermaid rendering fails gracefully: diagram hidden, body markdown shown, optional "Diagram could not be rendered" note. |
| 7 | Repository has no `package.json`, `Makefile`, or `docker-compose.yml` | Server passes whatever config files exist (may be none). LLM generates `run_locally` based on available information only. |
| 8 | Onboarding exists but the repo's `defaultBranch` changed since generation | "Open" links use the current `defaultBranch` from the `repos` table at render time, not a value stored in the onboarding data. |
| 9 | User regenerates tour -- old sections briefly visible during loading | Client replaces content with full-page spinner during regeneration. Old content is not visible. |
| 10 | LLM returns fewer or more than 5 sections | Zod validation rejects (array length must be exactly 5). Retry logic fires. If retry also fails, 500 returned, no DB write. |
| 11 | `input_sha` stored but the index was later deleted and rebuilt with a different SHA | The stored `input_sha` becomes stale. This is informational only (no staleness-gating logic in v1). User can regenerate to update. |
| 12 | Language parameter is set to a non-English value (e.g., `"uk"`) | System prompt instructs LLM to write titles and body in the requested language. Code identifiers, paths, and tech names remain verbatim. |

## Non-functional requirements

- **Performance**: LLM generation may take up to 60 seconds. The HTTP
  request timeout shall accommodate this. GET responses (cached result from
  DB) shall return in under 200ms. The top-15 file content read shall be
  bounded by 100 lines per file (simple truncation) to limit prompt size.
- **Security**: All endpoints are workspace-scoped via `getContext()`. The
  POST endpoint must verify the repo belongs to the requesting workspace.
  File content read from disk for LLM input must be restricted to the
  repository clone directory. The system prompt includes the standard
  `INJECTION_GUARD` / untrusted-data wrapping for any repo content injected
  into the prompt.
- **Accessibility**: Semantic HTML (`main`, `h2`, `ol`/`ul`). Mermaid
  diagram has `aria-label="Architecture diagram"`. Copy-button feedback uses
  `aria-live="polite"` toast. Standard keyboard navigation. No custom
  table-of-contents navigation for v1 (flagged as future enhancement).

## Inputs and provenance

| Input | Source | Format |
|-------|--------|--------|
| Repo map | `getRepoMap()` from repo-intel module | Structured text (file-tree + annotations) |
| File tree | Walk pipeline (clone directory traversal) | Array of file paths |
| Top-15 PageRank files (content) | `getCriticalPaths()` + disk read (first 100 lines) | Text content per file |
| Config files | Disk read from clone: `package.json`, `Makefile`, `docker-compose.yml`, `README.md` | Raw file content |
| File facts | `fileFacts` from repo-intel (endpoints, crons, etc.) | Structured facts per file |
| Index state SHA | `lastIndexedSha` from repo-intel index state | Hex string or null |
| Repo metadata | `repos` table: `owner`, `name`, `defaultBranch` | DB columns |
| Language preference | POST body or workspace settings | String, default `"en"` |
| Model selection | Workspace `feature_models` override or registry default | `FeatureModelChoice` |

## Untrusted inputs

| Input | Risk | Validation |
|-------|------|------------|
| Repository file content (injected into LLM prompt) | Prompt injection -- repo files could contain instructions that alter LLM behavior | Wrap all repo content in `<untrusted>...</untrusted>` blocks per existing system prompt convention. The `INJECTION_GUARD` is appended automatically. |
| LLM response JSON | Malformed JSON, missing fields, extra sections, wrong types, diagram in non-architecture sections | Zod parse with strict schema. Post-parse normalization: enforce `diagram: null` for non-architecture sections. Reject if section count is not exactly 5. Retry once on failure. |
| `language` parameter in POST body | Arbitrary string could alter prompt behavior | Validate as a short alpha string (e.g., ISO 639-1 code, max 5 chars). Default to `"en"` if missing or invalid. |
| `repoId` path parameter | Reference to repo in another workspace | Workspace scoping via `getContext()` ensures the repo belongs to the requesting workspace. |
| Mermaid diagram content (rendered client-side) | XSS via malicious Mermaid syntax | Mermaid library renders in a sandboxed SVG. Use Mermaid's `securityLevel: 'strict'` configuration. Graceful fallback on render failure. |

## Open questions

- [ ] **System prompt update scope**: The existing `onboarding.system.md`
  references `routes_and_apis` as a section kind and allows Mermaid diagrams
  for both `architecture` and `routes_and_apis`. The prompt must be updated
  to reflect the 5 canonical sections and the Mermaid-only-for-architecture
  rule. This spec defines the behavioral requirement; exact prompt wording
  is an implementation detail.
- [ ] **Exact Zod validation for section count**: Should the schema enforce
  `.length(5)` on the sections array, or should post-parse logic validate
  count and order? Either approach satisfies the requirement; implementation
  decides.
- [ ] **In-memory lock lifecycle**: If the server process restarts mid-generation,
  the lock is lost. The client's next GET returns 404 (empty state) and the
  user can retry. This is acceptable for v1 but should be documented.
- [ ] **`input_sha` staleness detection**: Should the client show a
  "Tour may be outdated" indicator when the current index SHA differs from
  the stored `input_sha`? Deferred to a future iteration.
- [ ] **Accessibility: table-of-contents navigation**: A sticky sidebar TOC
  for jumping between the 5 sections would improve usability. Flagged as a
  future enhancement, not included in v1.
- [ ] **i18n file update**: The existing `client/messages/en/onboarding.json`
  has stale section descriptions (references "overview, architecture, key
  modules, getting started, and conventions & gotchas"). It needs updating to
  match the 5 canonical section display names. This is an implementation
  detail.
