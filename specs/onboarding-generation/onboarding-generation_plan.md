# Implementation Plan: Onboarding Generation

**Spec:** `specs/onboarding-generation/onboarding-generation.spec.md`
**Scope:** server, client (cross-package)
**Estimated complexity:** high
**Multi-agent execution:** no (server and client steps are sequential; shared contract must exist before client work begins)
**Created:** 2026-08-16
**Revised:** 2026-08-16 (cross-review gaps RF-1 through RF-10 addressed; RF-A timeout 504 fix; RF-B/E/F/G informational notes; RF-1/RF-2/RF-3/RF-5/RF-6/RF-7/RF-8 second-pass fixes)

## Context

New developers joining a project face a steep ramp-up curve. DevDigest already indexes
repositories (symbols, PageRank, file facts) but does not synthesize that knowledge into
a structured onboarding narrative. This feature adds a one-click "Generate onboarding tour"
action that produces a 5-section guided tour grounded in repo-intel data, stored as a
single document per repository, and rendered on a dedicated client page with Mermaid
diagram support, copy-to-clipboard for shell commands, and "Open on GitHub" links.

Link to spec: `specs/onboarding-generation/onboarding-generation.spec.md`

## Requirements Summary

The spec defines 5 EARS patterns across 22 acceptance criteria:
- **Ubiquitous (U1-U10):** DB schema, Zod contracts, API shape, route structure, section kinds, semantic HTML, i18n display names.
- **Event-Driven (E1-E8):** GET/POST behavior, loading states, LLM data gathering, clipboard actions, GitHub links, model resolution.
- **State-Driven (S1-S3):** In-memory lock during generation, loading state, empty state.
- **Optional Feature (O1-O2):** Module registration, regenerate button.
- **Unwanted (X1-X7):** Retry logic, 409 conflict, graceful degradation, empty critical paths, timeout, Mermaid fallback, network error.

## Spec Coverage Matrix

| Criterion | EARS Pattern | Plan Step(s) | Status |
|-----------|-------------|--------------|--------|
| AC-U1: onboarding table schema | Ubiquitous | Step 1, Step 2 | COVERED |
| AC-U2: OnboardingSectionKind enum in new contract | Ubiquitous | Step 3 | COVERED |
| AC-U3: exactly 5 sections in fixed order | Ubiquitous | Step 3, Step 5 | COVERED |
| AC-U4: diagram non-null only for architecture | Ubiquitous | Step 5 (post-parse normalizer) | COVERED |
| AC-U5: GET and POST endpoints | Ubiquitous | Step 6 | COVERED |
| AC-U6: GET response shape | Ubiquitous | Step 4, Step 6 | COVERED |
| AC-U7: POST accepts optional language body | Ubiquitous | Step 6 | COVERED |
| AC-U8: client route /repos/[repoId]/onboarding | Ubiquitous | Step 8 | COVERED |
| AC-U9: i18n display names | Ubiquitous | Step 7 | COVERED |
| AC-U10: semantic HTML, aria-label, aria-live | Ubiquitous | Step 9 | COVERED |
| AC-E1: GET on navigate, 200 vs 404 | Event-Driven | Step 6, Step 8, Step 9 | COVERED |
| AC-E2: POST on generate/regenerate click | Event-Driven | Step 8, Step 9 | COVERED |
| AC-E3: LLM input data gathering | Event-Driven | Step 5 | COVERED |
| AC-E4: Zod parse + upsert on LLM success | Event-Driven | Step 4, Step 5 | COVERED |
| AC-E5: copy shell command to clipboard | Event-Driven | Step 9 | COVERED |
| AC-E6: Open on GitHub link | Event-Driven | Step 9 | COVERED |
| AC-E7: share button copies URL | Event-Driven | Step 9 | COVERED |
| AC-E8: workspace feature_models override | Event-Driven | Step 5 | COVERED |
| AC-S1: in-memory per-repo lock, GET returns generating | State-Driven | Step 5, Step 6 | COVERED |
| AC-S2: client loading state during generation | State-Driven | Step 9 | COVERED |
| AC-S3: empty state when no tour exists | State-Driven | Step 9 | COVERED |
| AC-O1: module registration | Optional Feature | Step 6 | COVERED |
| AC-O2: regenerate button replaces CTA | Optional Feature | Step 9 | COVERED |
| AC-X1: retry once on Zod parse failure, HTTP 500 on exhaustion | Unwanted | Step 5 | COVERED |
| AC-X2: 409 on concurrent generation | Unwanted | Step 5, Step 6 | COVERED |
| AC-X3: graceful degradation when no index | Unwanted | Step 5 | COVERED |
| AC-X4: empty critical paths still generates 5 sections | Unwanted | Step 5 | COVERED |
| AC-X5: 60s timeout returns HTTP 504 | Unwanted | Step 5, Step 6 | COVERED |
| AC-X6: Mermaid render failure fallback | Unwanted | Step 9 | COVERED |
| AC-X7: LLM network error returns 502 | Unwanted | Step 5 | COVERED |

## Recommendations Applied

1. **Structured output via `completeStructured` with service-layer error discrimination** -- use the
   same pattern as conventions (`llm.completeStructured<T>()` with a strict Zod schema).
   The `completeStructured` implementation in the LLM adapters (openai.ts, anthropic.ts)
   already has its own parse-failure retry loop: the `for (attempt = 1..maxRetries+1)` loop
   calls the LLM, runs `parseWithRepair`, and reprompts on schema failure. Setting
   `maxRetries: 1` on the `StructuredRequest` means exactly 2 attempts for parse failures.
   Network/rate-limit errors are handled separately by `withRetry()` wrapping each HTTP
   call within the loop. However, `completeStructured` throws `ExternalServiceError` (502)
   for BOTH parse exhaustion and network failures. The spec (AC-X1) requires HTTP 500 for
   parse exhaustion, not 502. Therefore the service layer must distinguish these two cases:
   the service wraps the `completeStructured` call and, if the thrown `ExternalServiceError`
   message contains the parse-failure sentinel (e.g., `'failed schema validation'`), re-throws
   as `AppError('parse_failure', ..., 500)`. Network/provider `ExternalServiceError` instances
   (whose messages do NOT contain that sentinel) propagate as-is with 502.

2. **In-memory lock via `Map<string, Promise>`** -- store the generation promise itself
   in a module-level `Map<string, Promise<OnboardingResult>>`. This allows GET during
   generation to detect the lock and return `{ status: 'generating' }`. The promise
   auto-cleans on resolve/reject (with a `.finally()` delete). No separate boolean state
   needed.

3. **Walk pipeline reuse** -- for the fallback file tree when no index exists (AC-X3),
   import `walkClone()` from `repo-intel/pipeline/walk.ts` rather than implementing a
   new directory walker.

4. **Section count via `.length(5)` on Zod array** -- simpler than post-parse validation;
   triggers the provider's retry on wrong count during `completeStructured`.

5. **Post-parse normalization for `diagram`** -- rather than rejecting when the LLM
   returns `diagram` on non-architecture sections, silently set to `null` after parse.
   This avoids wasting a retry on a recoverable deviation. The `diagram` field in the
   strict Zod schema is typed as `z.string().nullish()` (matching the base
   `OnboardingSection` from `knowledge.ts`), so the LLM may return any string or null.
   Post-parse normalization runs AFTER the Zod parse succeeds and forces
   `diagram = null` on all non-`architecture` sections regardless of what the LLM returned.

6. **Broadened degradation condition for AC-X3** -- the fallback triggers when the
   `IndexState` indicates the index is unavailable, not only when both map and top files
   are empty. See the "Degradation condition" subsection in Step 5 for the precise logic.

## Architecture Constraints

- **vendor/shared/ extend-only** -- new `contracts/onboarding.ts` file; existing
  `knowledge.ts` is NOT edited. Source: `CLAUDE.md`, `server/CLAUDE.md`.
- **vendor/shared client copy** -- new contract file must be physically copied to
  `client/src/vendor/shared/contracts/` and its barrel export updated in both
  `server/src/vendor/shared/index.ts` and `client/src/vendor/shared/index.ts`.
  Source: `client/INSIGHTS.md` entry `2026-08-06`.
- **Modules registered statically** in `server/src/modules/index.ts`. Source: `CLAUDE.md`.
- **Migrations NOT applied on boot** -- plan must include explicit migration step.
  Source: `CLAUDE.md`.
- **INJECTION_GUARD** -- system prompt must use `hardenSystemPrompt()` from
  `reviewer-core/src/prompt.ts`. Repo content must be wrapped with
  `wrapUntrusted()`. Source: `CLAUDE.md`, `reviewer-core/INSIGHTS.md`.
- **Routes delegate to Service** -- routes.ts is thin; business logic in service.ts,
  DB access in repository.ts. Source: `server/INSIGHTS.md` entry `2026-08-07`.
- **Drizzle ORM in repository only** -- service layer must not import `eq` or other
  Drizzle operators. Source: `server/INSIGHTS.md` entry `2026-08-15`.
- **Secrets via SecretsProvider** -- LLM keys resolved through `container.llm(provider)`.
  Source: `CLAUDE.md`.
- **nav.ts is vendor (read-only)** -- cannot add nav item there. The sidebar already
  has the `onboarding-tour` key in `shell.json` (line 19) and `activeKeyFor()` in
  `app-shell/helpers.ts` (line 29) already returns `"onboarding-tour"` for paths
  containing `/onboarding`. No additional nav work is needed. Source:
  `client/INSIGHTS.md` entry `2026-08-16`.
- **`apiFetch` only sets content-type when body is present** -- the POST for
  generation with empty body must NOT send content-type header; `api.post(path)`
  without a body argument handles this correctly.
  Source: `client/CLAUDE.md` gotchas, `client/src/lib/api.ts`.
- **`aria-live="polite"` toast region already exists** -- the `ToastProvider` in
  `client/src/lib/toast.tsx` (line 91) renders its container `<div>` with
  `role="status"` and `aria-live="polite"`. The `useToast()` hook renders toasts
  into this region automatically. No additional work is needed for AC-U10's
  copy-button toast accessibility requirement.
- **`getFileFacts()` is NOT on the `RepoIntel` facade** -- the method exists only on
  `RepoIntelRepository` (`server/src/modules/repo-intel/repository.ts`, line 534).
  The `RepoIntel` interface (`server/src/modules/repo-intel/types.ts`) does not
  expose it. The onboarding service must query the `file_facts` table directly
  through its own `OnboardingRepository`, not through `container.repoIntel`.
  Source: codebase inspection of `types.ts` (the facade interface has no `getFileFacts`).

## Pre-implementation Checklist

- [x] Migration needed? **Yes** -- add `model` (text, not null, default) and `input_sha` (text, nullable) to `onboarding` table. Also verify/assert `generated_at` has NOT NULL + DEFAULT now() constraints.
- [x] New module needed? **Yes** -- `server/src/modules/onboarding/`, register in `modules/index.ts`.
- [x] New shared contracts needed? **Yes** -- `contracts/onboarding.ts` in vendor/shared (both server and client copies).
- [x] New adapter needed? **No** -- uses existing `LLMProvider` via container.

## Steps

### Step 1: Add columns to onboarding DB schema and verify existing constraints

**Package:** server
**Files:** `server/src/db/schema/context.ts` (modify)
**What:** Add two columns to the existing `onboarding` table definition:
- `model`: `text('model').notNull().default('deepseek/deepseek-v4-flash')` -- the model identifier used for generation.
- `inputSha`: `text('input_sha')` -- nullable, stores the repo-intel index SHA at generation time.

The table already has `repoId` (PK, FK to repos, cascade), `json` (jsonb), and `generatedAt` (timestamptz). Verify the existing `generatedAt` column definition has both `.notNull()` and `.defaultNow()` -- the current schema (line 125 of `context.ts`) reads `timestamp('generated_at', { withTimezone: true }).defaultNow().notNull()`, which is correct. No changes needed to `generatedAt` itself, but the migration step (Step 2) must assert the constraints exist in the generated SQL.

**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`
**Tests:** No test needed for schema definition; covered by migration and integration test.
**Depends on:** none
**Addresses:** AC-U1

### Step 2: Generate and apply DB migration

**Package:** server
**Files:** `server/src/db/migrations/0014_*.sql` (create)
**What:** Run `pnpm db:generate` to produce the migration adding `model` and `input_sha` columns. The migration is an `ALTER TABLE onboarding ADD COLUMN` with defaults, which is safe (no table rewrite for non-volatile defaults). Then run `pnpm db:migrate`.

The migration file name is auto-generated by Drizzle Kit. Verify it contains:
```sql
ALTER TABLE "onboarding" ADD COLUMN "model" text NOT NULL DEFAULT 'deepseek/deepseek-v4-flash';
ALTER TABLE "onboarding" ADD COLUMN "input_sha" text;
```

Additionally, verify the existing `generated_at` column already has the correct constraints (`NOT NULL DEFAULT now()`). The current Drizzle schema defines `.defaultNow().notNull()` which produces `timestamptz NOT NULL DEFAULT now()` in the initial migration. If for any reason the migration output shows an ALTER on `generated_at`, review it to confirm it adds/preserves the `NOT NULL DEFAULT now()` constraints. If the constraints are missing (e.g., an earlier migration was incomplete), add:
```sql
ALTER TABLE "onboarding" ALTER COLUMN "generated_at" SET NOT NULL;
ALTER TABLE "onboarding" ALTER COLUMN "generated_at" SET DEFAULT now();
```

**Skills:** `drizzle-orm-patterns`
**Tests:** `pnpm db:migrate` succeeds without error. After migration, verify via `\d onboarding` in psql that `generated_at` is `timestamptz NOT NULL DEFAULT now()`, `model` is `text NOT NULL DEFAULT 'deepseek/...'`, and `input_sha` is `text` (nullable).
**Depends on:** Step 1
**Addresses:** AC-U1

### Step 3: Create OnboardingSectionKind contract

**Package:** server + client
**Files:**
- `server/src/vendor/shared/contracts/onboarding.ts` (create)
- `server/src/vendor/shared/index.ts` (modify -- add re-export)
- `client/src/vendor/shared/contracts/onboarding.ts` (create -- physical copy)
- `client/src/vendor/shared/index.ts` (modify -- add re-export)

**What:** Create a new contract file defining:
1. `OnboardingSectionKind` -- a Zod enum with exactly 5 members: `'architecture'`, `'critical_paths'`, `'run_locally'`, `'reading_path'`, `'first_tasks'`.
2. `SECTION_ORDER` -- a const array of the 5 kinds in canonical order, for validation.
3. `OnboardingSectionStrict` -- a stricter version of `OnboardingSection` (from `knowledge.ts`) where `kind` is `OnboardingSectionKind` instead of `z.string()`, and `diagram` is `z.string().nullish()` (matching the base `OnboardingSection`). The `diagram` field is intentionally permissive at the Zod level -- it accepts any string or null from the LLM. Post-parse normalization (in the service layer) enforces `diagram = null` for non-architecture sections AFTER the Zod parse succeeds. This avoids burning a parse-failure retry on a recoverable deviation.
4. `OnboardingResponse` -- the API response shape: `{ sections: OnboardingSection[], model: string, generated_at: string, input_sha: string | null }`. Uses the base `OnboardingSection` (from knowledge.ts) in the response so the contract remains backward-compatible.
5. `OnboardingGeneratingResponse` -- `{ status: z.literal('generating') }` for the in-progress state.
6. `GenerateOnboardingBody` -- `{ language?: string }` validated as a short alpha string (regex `/^[a-zA-Z]{2,5}$/`). If missing, the route layer defaults to `"en"`. If present but invalid (too long, non-alpha), the Zod parse rejects the request body (Fastify returns 400).

The existing `OnboardingSection` in `knowledge.ts` is NOT edited (extend-only rule). The new file imports the base types from `knowledge.ts` and refines them.

Add `export * from './contracts/onboarding.js';` to both server and client barrel files.

**Skills:** `zod`, `typescript-expert`
**Tests:** Unit test for:
- `OnboardingSectionKind.parse()` accepts valid kinds, rejects invalid strings.
- `GenerateOnboardingBody.parse()` accepts `{ language: "en" }`, `{ language: "uk" }`, `{}` (optional).
- `GenerateOnboardingBody.parse()` rejects `{ language: "toolong123" }`, `{ language: "1!" }` (non-alpha, too long).
**Depends on:** none
**Addresses:** AC-U2, AC-U3, AC-U6, AC-U7

### Step 4: Create OnboardingRepository

**Package:** server
**Files:** `server/src/modules/onboarding/repository.ts` (create)
**What:** Repository class with methods:
1. `getByRepoId(repoId: string)` -- `SELECT * FROM onboarding WHERE repo_id = ?`. Returns the row or `null`.
2. `upsert(repoId: string, data: { json: object, model: string, inputSha: string | null })` -- `INSERT ... ON CONFLICT (repo_id) DO UPDATE SET json = ?, model = ?, input_sha = ?, generated_at = now()`. Returns the upserted row.
3. `getRepoForWorkspace(workspaceId: string, repoId: string)` -- `SELECT * FROM repos WHERE id = ? AND workspace_id = ?`. Returns the repo row or `null`. Used for ownership validation.
4. `getFileFacts(repoId: string, files: string[])` -- `SELECT file_path, endpoints, crons FROM file_facts WHERE repo_id = ? AND file_path IN (?)`. Returns an array of `{ filePath: string, endpoints: string[], crons: string[] }`. This method queries the `file_facts` table directly because `getFileFacts()` is NOT exposed on the `RepoIntel` facade interface -- it only exists on `RepoIntelRepository` (see `server/src/modules/repo-intel/repository.ts`, line 534). Following the same SELECT pattern used there (columns: `filePath`, `endpoints`, `crons`), the onboarding repository accesses the shared `file_facts` table through the same Drizzle schema import (`../../db/schema.js`). Return `[]` when the `files` array is empty (short-circuit, no query).

The repository takes `Db` in its constructor (same pattern as `ConventionsRepository`).
Import table definitions from `../../db/schema.js`.

**Skills:** `drizzle-orm-patterns`, `onion-architecture`
**Tests:** Integration test `repository.it.test.ts` -- upsert + getByRepoId round-trip; getFileFacts returns matching rows.
**Depends on:** Step 1, Step 2
**Addresses:** AC-E4, AC-U1, AC-U6

### Step 5: Create OnboardingService and update system prompt

**Package:** server
**Files:**
- `server/src/modules/onboarding/service.ts` (create)
- `server/src/prompts/onboarding.system.md` (modify)

**What:** Service class containing the core business logic. The system prompt file
(`onboarding.system.md`) is edited in this step only -- not duplicated in any other step.

**Constructor:** Takes `Container`, creates `OnboardingRepository(container.db)`.

**Module-level lock:** `const generationLocks = new Map<string, Promise<OnboardingResult>>()` -- keyed by `repoId`. The lock is set before the LLM call and removed in `.finally()`.

**Methods:**

1. `getOnboarding(workspaceId: string, repoId: string)` -- validates workspace ownership via `repo.getRepoForWorkspace()`. If the repo has an in-progress lock, returns `{ status: 'generating' }`. Otherwise queries the DB via `repo.getByRepoId()`. Returns the response DTO or `null` (caller maps to 404).

2. `generateOnboarding(workspaceId: string, repoId: string, language: string)` -- the main generation flow:
   a. Validate workspace ownership.
   b. Check `generationLocks` -- if already in progress, throw `AppError('conflict', 'Generation already in progress', 409)`.
   c. Set the lock: `generationLocks.set(repoId, doGenerate(...))`.
   d. `doGenerate()` performs:
      - Gather LLM input data (see below).
      - Resolve model via `resolveFeatureModel(container, workspaceId, 'onboarding')`.
      - Build system prompt: load `onboarding.system.md` via `renderPrompt()`, then harden with `hardenSystemPrompt()`.
      - Build user message: assemble gathered data with `wrapUntrusted()` for all repo content.
      - Call `llm.completeStructured<StrictOnboarding>()` with `maxRetries: 1`, `timeoutMs: 60_000`, and the strict Zod schema (`OnboardingSectionStrict` array of length 5).
      - Post-parse normalization: iterate all sections, set `diagram = null` for any section where `kind !== 'architecture'`. This runs AFTER the Zod parse succeeds (the schema allows `diagram` as `z.string().nullish()` for all sections to avoid burning parse retries).
      - Upsert result via repository.
      - Return response DTO.
   e. `.finally(() => generationLocks.delete(repoId))`.
   f. Error handling -- three distinct failure modes (AC-X1, AC-X5, AC-X7):

      The `completeStructured` method in the LLM adapters wraps each HTTP call as `withRetry(() => withTimeout(..., timeoutMs))`. `withTimeout` (in `server/src/platform/resilience.ts`) throws `TimeoutError` (a class extending `Error` with `name = 'TimeoutError'`) when the deadline expires. Crucially, `defaultIsRetryable` in `withRetry` checks for `code === 'ETIMEDOUT'` but `TimeoutError` does NOT set a `.code` property -- it only sets `.name = 'TimeoutError'`. Therefore `TimeoutError` is NOT retryable and propagates directly out of `completeStructured` to the service layer.

      The service must distinguish three error types:

      - **Timeout (AC-X5):** Catch `TimeoutError` (imported from `../../platform/resilience.js`) by checking `err instanceof TimeoutError`. Re-throw as `AppError('llm_timeout', 'LLM call timed out', 504)`. This produces HTTP 504 via the global error handler (which checks `err instanceof AppError` and uses `err.statusCode`).
      - **Parse exhaustion (AC-X1):** Both `completeStructured` implementations (openai.ts line 132, anthropic.ts line 147) throw `ExternalServiceError` with a message containing `'failed schema validation'` when all parse-retry attempts are exhausted. The spec explicitly requires HTTP **500** (not 502) for this case. The service must catch `ExternalServiceError`, inspect the message for the parse-failure sentinel string `'failed schema validation'`, and re-throw as `AppError('parse_failure', 'LLM response failed validation after 2 attempts', 500)`.
      - **Network/provider errors (AC-X7):** Other `ExternalServiceError` instances (network failures, rate limits, provider outages) do NOT contain `'failed schema validation'` in their message. Let these propagate as-is -- the global error handler maps `ExternalServiceError` (which has `statusCode: 502` built in from `server/src/platform/errors.ts` line 31-34) to HTTP 502.

      The catch block structure in `doGenerate()` should be:
      ```
      try { ... completeStructured ... } catch (err) {
        if (err instanceof TimeoutError) {
          throw new AppError('llm_timeout', 'LLM call timed out', 504);
        }
        if (err instanceof ExternalServiceError &&
            err.message.includes('failed schema validation')) {
          throw new AppError('parse_failure',
            'LLM response failed validation after 2 attempts', 500);
        }
        throw err; // Other ExternalServiceError (502) or unexpected errors propagate
      }
      ```

      **No-DB-write guarantee on all three failure paths:** The upsert call occurs AFTER the `completeStructured` call succeeds and post-parse normalization runs. If `completeStructured` throws (whether `TimeoutError`, parse-exhaustion `ExternalServiceError`, or network `ExternalServiceError`), execution never reaches the upsert line. This guarantee holds without any additional logic.

**Retry logic detail (AC-X1):**
The `completeStructured` method in both OpenAI and Anthropic adapters has a built-in parse-failure retry loop:
- The `for (attempt = 1; attempt <= maxRetries + 1; attempt++)` loop makes the LLM call, then calls `parseWithRepair(schema, rawOutput)`.
- If the parse fails, it appends the raw output and a reprompt message to the conversation, then retries.
- `withRetry()` wraps each individual HTTP call inside the loop and handles ONLY network/rate-limit/5xx errors (via `defaultIsRetryable` in `resilience.ts`). It does NOT catch Zod parse failures.
- Setting `maxRetries: 1` on the `StructuredRequest` means: up to 2 parse attempts. If both fail, `completeStructured` throws `ExternalServiceError` with message containing `'failed schema validation'`.
- The service does NOT add its own retry loop. `completeStructured` is the single point of parse-failure retry. The service only re-classifies the resulting error from 502 to 500.

**Data gathering** (sub-method `gatherLlmInput`):

**Degradation condition (AC-X3):**
The spec says degrade "when repo-intel index is not available." The condition is defined as:
1. Call `getIndexState(repoId)` from `container.repoIntel`.
2. The index is considered "not available" when ANY of these are true:
   - `indexState.status === 'degraded'` (index never created, no data at all)
   - `indexState.status === 'failed'` (index attempt failed)
   - `indexState.degraded === true` (facade synthesized a degraded state, e.g. `no_data`)
   - `!indexState.lastIndexedSha` (no SHA recorded, meaning index was never completed)

**`getIndexState()` return type reference (RF-8):** The `IndexState` interface is defined in `server/src/modules/repo-intel/types.ts` (lines 43-51). It extends `IndexResult` (lines 35-41) and adds: `repoId: string`, `lastIndexedSha: string`, `indexerVersion: number`, `updatedAt: Date`, `degraded?: boolean`, `degradedReason?: DegradedReason`. The `status` field (from `IndexResult`) is typed as `IndexStatus = 'full' | 'partial' | 'degraded' | 'failed'` (line 25). The `DegradedReason` type (lines 27-33) is a union of `'flag_off' | 'index_failed' | 'index_partial' | 'repo_too_large' | 'no_data' | 'unranked_callers'`. When no index row exists, `getIndexState()` (service.ts line 190) synthesizes a degraded response with `status: 'degraded'`, `lastIndexedSha: ''` (empty string), `degraded: true`, `degradedReason: 'no_data'`.

When the index is not available by ANY of these conditions:
- Skip `getRepoMap()`, `getTopFilesByRank()`, `getCriticalPaths()`, file facts query.
- Instead, use `walkClone(clonePath)` for the file tree.
- Read root config files: `package.json`, `README.md`, `docker-compose.yml`, `Makefile` from the clone root (skip missing files silently).
- Set `input_sha = null`.
- Log a warning: `"Repo-intel index not available for repo ${repoId} (status: ${indexState.status}, reason: ${indexState.degradedReason}); using fallback data"`.

When the index IS available (none of the above conditions apply):
- Proceed with full data gathering: `getRepoMap()`, `getTopFilesByRank(repoId, 15)`, `getCriticalPaths()`, and file facts via `this.repo.getFileFacts(repoId, topFiles)` (the onboarding repository's own method, NOT `container.repoIntel.getFileFacts()` which does not exist on the facade).
- Even if `getRepoMap()` returns `degraded: true` at the individual method level (e.g., cache miss but index exists), the service still proceeds with whatever data IS available from the other methods. The degradation check is at the index state level, not per-method.
- **Empty critical paths (AC-X4):** if `getCriticalPaths()` returns `[]`, log a warning but continue -- the LLM synthesizes from available data.

For each top file (non-fallback path), read first 100 lines from disk (clone path + file path). Use `readFile` with `path.resolve()` + `startsWith` boundary check (security: path traversal prevention per INSIGHTS.md). Use `path.resolve(clonePath)` + `sep` as the boundary prefix.

Read config files: `package.json`, `Makefile`, `docker-compose.yml`, `README.md` from clone root. Skip missing files silently (edge case 7).

`getIndexState()` -- for `lastIndexedSha` (stored as `input_sha`).

**Prompt template update** (`onboarding.system.md`):
This is the ONLY step that touches the prompt file. No other step modifies it.
- Replace the `{{sections}}` placeholder content to list the 5 canonical sections: `architecture`, `critical_paths`, `run_locally`, `reading_path`, `first_tasks` with clear descriptions of what each section should contain.
- Remove `routes_and_apis` references.
- Restrict Mermaid `diagram` to `architecture` section only (remove `routes_and_apis` allowance).
- Remove the `routes_and_apis` formatting guidance paragraph ("In `routes_and_apis`:...").
- Keep all existing grounding rules, security wrappers, and formatting guidance.
- Keep the `{{language}}` placeholder.
- **Verbatim-identifier constraint for non-English languages (edge case 12):** The prompt MUST include an explicit instruction for language-aware generation: "Write all prose, descriptions, and titles in `{{language}}`. Keep all code identifiers, file paths, function names, library names, and technical terms verbatim in their original form regardless of language." This is not merely a `{{language}}` placeholder substitution -- the prompt must contain this verbatim-preservation rule so the LLM does not translate code identifiers, paths, or tech names when generating in non-English languages.

**Skills:** `fastify-best-practices`, `onion-architecture`, `zod`, `typescript-expert`, `security`
**Tests:**
- Unit test `service.test.ts`: mock container (LLM, repoIntel, DB), test:
  - Successful generation flow -- full index available.
  - Lock prevents concurrent generation (409).
  - Fallback data gathering when `indexState.status === 'degraded'` (all methods skipped, walkClone used).
  - Fallback data gathering when `indexState.degraded === true` but `status` is not literally `'degraded'` (e.g., `'failed'`) -- confirms broadened condition.
  - Fallback data gathering when `!indexState.lastIndexedSha` -- partial index state with no SHA triggers fallback.
  - Post-parse normalization sets `diagram = null` for non-architecture sections.
  - **Zod parse exhaustion raises AppError with statusCode 500 (not 502), no DB write.** Mock `completeStructured` to throw `new ExternalServiceError('OpenAI structured output failed schema validation', { raw: '...' })`. Verify the service re-throws as `AppError` with `statusCode === 500` and `code === 'parse_failure'`. Verify the repository's `upsert` was NOT called.
  - **Network error from LLM raises ExternalServiceError with statusCode 502, no DB write.** Mock `completeStructured` to throw `new ExternalServiceError('OpenAI request failed: ECONNREFUSED')`. Verify the error propagates as-is (not re-classified to 500). Verify `upsert` was NOT called.
  - **LLM timeout raises AppError with statusCode 504, no DB write.** Mock `completeStructured` to throw `TimeoutError(60_000)` (imported from `../../platform/resilience.js`). Verify the service re-throws as `AppError` with `statusCode === 504` and `code === 'llm_timeout'`. Verify the repository's `upsert` was NOT called.
  - Empty `getCriticalPaths()` logs warning but proceeds (AC-X4).
**Depends on:** Step 3, Step 4
**Addresses:** AC-E3, AC-E4, AC-E8, AC-S1, AC-X1, AC-X2, AC-X3, AC-X4, AC-X5, AC-X7, AC-U3, AC-U4

### Step 6: Create onboarding routes and register module

**Package:** server
**Files:**
- `server/src/modules/onboarding/routes.ts` (create)
- `server/src/modules/index.ts` (modify)

**What:** Fastify plugin (default export) registering two endpoints, plus module registration.

1. `GET /repos/:id/onboarding`
   - Schema: `params: IdParams` (from `_shared/schemas.ts`).
   - Call `getContext(container, req)` for workspace scoping.
   - Call `service.getOnboarding(workspaceId, repoId)`.
   - If result has `status: 'generating'`, return 200 with `{ status: 'generating' }`.
   - If result is `null`, return 404 via `NotFoundError`.
   - Otherwise return 200 with the onboarding response DTO.
   - **GET reply schema discriminated union (RF-6):** The GET route's Fastify `schema.response[200]` must accommodate both the `OnboardingResponse` shape and the `{ status: 'generating' }` shape. If using Fastify's JSON Schema serialization, define the 200 response as a `oneOf` (or equivalent union) so that the `{ status: 'generating' }` response is not stripped by Fastify's schema serializer. Alternatively, omit the response schema for the 200 status code (Fastify will pass through the object as-is without serialization filtering). The implementer should verify which approach the codebase's other routes use for polymorphic 200 responses and follow the same pattern.

2. `POST /repos/:id/onboarding`
   - Schema: `params: IdParams`, `body: GenerateOnboardingBody` (from the new contract).
   - Call `getContext(container, req)`.
   - **Per-route timeout (RF-G):** Set a 65-second timeout (5s buffer over the 60s LLM timeout) using Fastify 5's per-route `request.raw.setTimeout(ms)` in the handler, or equivalently via the route option `{ config: { requestTimeout: 65_000 } }` if a `onRequest` hook reads it. The simplest Fastify 5 approach is to call `request.raw.setTimeout(65_000)` at the top of the handler. This overrides the server-level `requestTimeout` for this route only, preventing Fastify from closing the socket before the LLM call completes. Note: this is a Node.js `http.IncomingMessage.setTimeout()` call -- Fastify 5 does not have a built-in per-route timeout option in route shorthand, so the `request.raw` approach is the standard pattern.
   - **`request.raw.setTimeout()` socket behavior (RF-5):** `request.raw.setTimeout(65_000)` fires a `'timeout'` event on the socket but does NOT automatically close or destroy the socket. The implementer must verify how the existing server-level timeout plugin (if any) handles this event. If no server-level handler exists, attach `request.raw.on('timeout', () => { if (!reply.sent) reply.status(504).send({ error: { code: 'request_timeout', message: 'Request timed out' } }); })` in the POST handler. Check `server/src/app.ts` and any Fastify timeout plugins for existing `'timeout'` event handling before adding a new handler. The LLM-level `TimeoutError` at 60s will normally fire before the 65s socket timeout, so this is a safety net for edge cases where the LLM timeout does not fire (e.g., the LLM call hangs without triggering `withTimeout`).
   - Call `service.generateOnboarding(workspaceId, repoId, body.language ?? 'en')`.
   - Return the onboarding response DTO.
   - The service throws `AppError('llm_timeout', ..., 504)` on LLM timeout, `AppError('parse_failure', ..., 500)` on parse exhaustion, `AppError(409)` for concurrent requests, and `ExternalServiceError(502)` for network LLM failures -- all are `AppError` subclasses handled by the global error handler which reads `err.statusCode`.

The routes.ts file instantiates `OnboardingService(app.container)` in the plugin scope.

**Module registration** in `server/src/modules/index.ts`:
- Add `import onboarding from './onboarding/routes.js';`
- Add `onboarding` to the `modules` record.

**Skills:** `fastify-best-practices`, `onion-architecture`
**Tests:** Integration test `routes.it.test.ts`:
  - GET returns 404 when no onboarding exists.
  - POST generates and returns onboarding (mock LLM).
  - GET returns 200 after generation.
  - POST returns 409 when generation is already in progress.
  - POST with invalid `language` value (e.g., `"toolong123!"`) returns 400 (Fastify body validation).
  - **POST returns 500 when LLM parse retries are exhausted.** Mock the LLM adapter to throw `ExternalServiceError('... failed schema validation ...')`. Verify the response has status 500 and body `{ error: { code: 'parse_failure', ... } }`.
  - **POST returns 502 when LLM network error occurs.** Mock the LLM adapter to throw `ExternalServiceError('OpenAI request failed: ECONNREFUSED')`. Verify the response has status 502.
  - **POST returns 504 when LLM times out.** Mock the LLM adapter to throw `TimeoutError`. Verify the response has status 504 and body `{ error: { code: 'llm_timeout', ... } }`.
**Depends on:** Step 5
**Addresses:** AC-U5, AC-U6, AC-U7, AC-E1, AC-S1, AC-X1, AC-X2, AC-X5, AC-X7, AC-O1

### Step 7: Update i18n and client types

**Package:** client
**Files:**
- `client/messages/en/onboarding.json` (modify)
- `client/src/lib/types.ts` (modify, if onboarding types need to be added)

**What:**

1. Update `onboarding.json` to match the 5 canonical section display names. The exact i18n keys that need changes (RF-F):
   - **`generate.body`** (line 10): Change from `"DevDigest indexes the repo and specs, then writes a 5-section guided tour: overview, architecture, key modules, getting started, and conventions & gotchas."` to reference the correct 5 sections: `"DevDigest indexes the repo, then writes a 5-section guided tour: architecture overview, critical paths, how to run locally, guided reading path, and first tasks."` (or similar wording matching the canonical section names).
   - All other existing keys (`title`, `sections`, `sectionCount`, `regenerate`, `regenerating`, `unknownError`, `generate.title`, `generate.cta`, `generate.generating`, `loadError.title`) are already correct and do not reference specific section names -- no changes needed to those keys.
   - Optionally add a `"share.copied"` key for the share-button toast text (`"Link copied."`) if not already covered by a global toast key. Check whether the existing toast infrastructure has a reusable "copied" message before adding.

2. Ensure client types file exports or re-exports the `OnboardingResponse` and `OnboardingSection` types from the vendor/shared contracts.

**Skills:** `react-frontend-best-practices`
**Tests:** No test needed for i18n/types.
**Depends on:** Step 3
**Addresses:** AC-U9

### Step 8: Create onboarding TanStack Query hooks

**Package:** client
**Files:**
- `client/src/lib/hooks/onboarding.ts` (create)
- `client/src/lib/hooks/index.ts` (modify -- add re-export)

**What:** Two hooks following the conventions pattern:

1. `useOnboarding(repoId: string | null | undefined)` -- `useQuery`:
   - `queryKey: ["onboarding", repoId]`
   - `queryFn: () => api.get<OnboardingResponse | OnboardingGeneratingResponse>(\`/repos/${repoId}/onboarding\`)`
   - `enabled: !!repoId`
   - `retry: false` -- 404 is an expected state (no tour yet), not an error to retry.
   - Handle 404 by returning `null` (empty state) rather than throwing -- use `queryFn` that catches `ApiError` with status 404 and returns `null`. This is the 404-to-null conversion pattern.

2. `useGenerateOnboarding()` -- `useMutation`:
   - `mutationFn: ({ repoId, language }: { repoId: string; language?: string }) => api.post<OnboardingResponse>(\`/repos/${repoId}/onboarding\`, language ? { language } : undefined)`
   - `onSuccess: (_data, { repoId }) => qc.invalidateQueries({ queryKey: ["onboarding", repoId] })`

Add `export * from "./onboarding";` to `hooks/index.ts`.

**Skills:** `react-best-practices`, `react-frontend-best-practices`
**Tests:** Unit test `onboarding.test.ts` for the `useOnboarding` hook:
  - When API returns 404, the hook's data resolves to `null` (not an error state). This explicitly tests the 404-to-null conversion in the `queryFn`, ensuring the hook does not rely on TanStack Query's error path for 404 handling.
  - When API returns 200 with `OnboardingResponse`, the hook's data is the response object.
  - When API returns 200 with `{ status: 'generating' }`, the hook's data includes the generating status.

The hook unit test is important because the component test in Step 9 may mock the hook, which would not exercise the 404-to-null conversion logic.
**Depends on:** Step 3
**Addresses:** AC-E1, AC-E2

### Step 9: Create OnboardingView component and page

**Package:** client
**Files:**
- `client/src/app/repos/[repoId]/onboarding/page.tsx` (create)
- `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/OnboardingView.tsx` (create)
- `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/index.ts` (create)
- `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/constants.ts` (create)
- `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/styles.ts` (create)
- `client/src/app/repos/[repoId]/onboarding/_components/OnboardingView/helpers.ts` (create)
- `client/src/app/repos/[repoId]/onboarding/_components/SectionBlock/SectionBlock.tsx` (create)
- `client/src/app/repos/[repoId]/onboarding/_components/SectionBlock/index.ts` (create)

**What:**

**`page.tsx`** -- thin entry point (same pattern as `conventions/page.tsx`):
- `useParams<{ repoId: string }>()` for the route param.
- `useRepoNotFound(repoId)` guard.
- Render `<AppShell crumb={[{ label: "Onboarding Tour" }]}>` wrapping `<OnboardingView repoId={repoId} />`.

**`constants.ts`** -- section display name map:
```
SECTION_TITLES: Record<string, string> = {
  architecture: "Architecture Overview",
  critical_paths: "Critical Paths",
  run_locally: "How to Run Locally",
  reading_path: "Guided Reading Path",
  first_tasks: "First Tasks",
}
```

**Section display name source of truth (RF-E):** The `SECTION_TITLES` map in `constants.ts` is the runtime source for section `<h2>` headings in `SectionBlock.tsx`. The i18n file `onboarding.json` contains section names only in the `generate.body` description string (the CTA paragraph shown in the empty state), not as individually keyed display names. Therefore `constants.ts` is the authoritative source at render time for section headings. If section display names are later internationalized, they should move to individually keyed i18n entries (e.g., `sections.architecture`, `sections.critical_paths`) and `constants.ts` should be removed or reduced to a key-ordering list. For v1, the hardcoded English map in `constants.ts` is sufficient since the spec defines the display names as fixed strings (AC-U9).

**`helpers.ts`** -- pure functions:
- `buildGitHubUrl(owner, repo, branch, path)` -- constructs `https://github.com/{owner}/{repo}/blob/{branch}/{path}`.
- `copyToClipboard(text)` -- `navigator.clipboard?.writeText(text)`.

**`OnboardingView.tsx`** -- main component:
- Uses `useOnboarding(repoId)` and `useGenerateOnboarding()`.
- Uses `useActiveRepo()` to get `owner`, `name`, `default_branch` for GitHub links.
- Three UI states:
  1. **Loading/generating** (mutation pending OR query returns `{ status: 'generating' }`): full-page spinner with "Generating..." text, disabled button. **Edge case 9 (regeneration hides old content):** During mutation pending state (regeneration), old section data MUST NOT be visible. The component must show ONLY the spinner, not the previous tour content underneath. This means the state check for "loading/generating" must take priority over the "tour rendered" state -- if `mutation.isPending` is true, render the spinner regardless of whether `query.data` contains sections.
  2. **Empty state** (query returns null/404, no mutation pending): `<EmptyState>` with icon, title "Generate onboarding tour", CTA button.
  3. **Tour rendered** (query returns sections): header with "Regenerate" button + share button, then 5 `<SectionBlock>` components.
- Share button: copies `window.location.href` to clipboard, shows toast "Link copied."
- Semantic HTML: `<main>` wrapping everything. Each section is an `<h2>`.
- Toast integration via `useToast()` for copy confirmations. Toasts render into the existing `aria-live="polite"` region provided by `ToastProvider` (confirmed in `client/src/lib/toast.tsx` line 91). No additional aria-live work is needed.

**`SectionBlock.tsx`** -- renders one section:
- Receives `section: OnboardingSection`, `owner`, `repo`, `defaultBranch`.
- **Edge case 8 (defaultBranch at render time):** The `defaultBranch` prop is read from `useActiveRepo().activeRepo.default_branch` at render time in the parent `OnboardingView`, NOT from any value stored in the onboarding JSON. This ensures "Open" links always use the current `defaultBranch` from the `repos` table, even if the branch changed after the tour was generated. The `buildGitHubUrl` helper receives this live value.
- `<h2>` with the display name from `SECTION_TITLES[section.kind]`.
- If `section.kind === 'architecture'` and `section.diagram` is truthy, render `<MermaidDiagram chart={section.diagram} />` with `aria-label="Architecture diagram"`. Wrap in error boundary or check render state -- the existing `MermaidDiagram` component already handles invalid diagrams by rendering `null` (state "invalid"). Add a fallback note "Diagram could not be rendered" when the diagram prop is present but Mermaid renders nothing.
- `<Markdown>` for `section.body` (from `@devdigest/ui`).
- If `section.kind === 'run_locally'`, detect code blocks in the body markdown and add copy buttons. Implementation: use a custom `react-markdown` code component override that adds a copy button per code block.
- For `section.links` (critical_paths, reading_path): render as a list with "Open" buttons that open the GitHub URL in a new tab.

**Sidebar navigation:** No additional work is needed. The sidebar already has the `"onboarding-tour"` nav key in `client/messages/en/shell.json` (line 19: `"onboarding-tour": "Onboarding Tour"`), and `activeKeyFor()` in `client/src/components/app-shell/helpers.ts` (line 29) already returns `"onboarding-tour"` for any pathname containing `/onboarding`. The route `/repos/[repoId]/onboarding` will be recognized and highlighted in the sidebar automatically.

**Implementation verification checklist:**
- [ ] Verify `MermaidDiagram.tsx` uses `securityLevel: 'strict'` in its `mermaid.initialize()` call (RF-B). Confirmed at line 37: `mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" })`. If this has changed, restore it before proceeding.

**Skills:** `react-best-practices`, `react-frontend-best-practices`, `next-best-practices`, `typescript-expert`
**Tests:** Component test `OnboardingView.test.tsx`:
  - Renders empty state when no onboarding exists.
  - Renders tour sections after generation.
  - Displays "Generating..." during mutation.
  - **During regeneration (mutation pending), old section data is NOT visible -- only spinner is shown (edge case 9).** Set up the test with existing query data (sections), then trigger the mutation. Assert that no `<h2>` section headings or section body content are rendered while `mutation.isPending` is true.
  - Copy buttons call clipboard API.
  - "Open" links use `defaultBranch` from `useActiveRepo()`, not from onboarding data (edge case 8).
**Depends on:** Step 7, Step 8
**Addresses:** AC-U8, AC-U9, AC-U10, AC-E1, AC-E2, AC-E5, AC-E6, AC-E7, AC-S2, AC-S3, AC-O2, AC-X6

## Proactive Skills That Will Fire

- `engineering-insight` -- will fire; this plan modifies well over 3 files across both packages.
- `breaking-change` -- will not fire; no existing routes or contracts are modified, only new ones added. The `onboarding` table gains columns with defaults, which is backward-compatible.
- `response-schema` -- will not fire; no existing API response shapes are changed.
- `deprecation-policy` -- will not fire; no public APIs are removed.
- `semver-discipline` -- will not fire; no published package version is bumped.

## Risk Assessment

1. **Risk: LLM returns sections in wrong order or with wrong kinds.**
   Mitigation: The strict Zod schema (`OnboardingSectionStrict` with `.length(5)` and kind as enum) plus `maxRetries: 1` on `completeStructured` handles this. The `completeStructured` implementation reprompts with the parse error message on failure. The prompt template explicitly lists the 5 sections in order. If both attempts fail, the service catches the `ExternalServiceError` and re-throws as `AppError('parse_failure', ..., 500)`, and no data is written (AC-X1).

2. **Risk: Path traversal when reading file content from clone directory.**
   Mitigation: Use `path.resolve(clonePath, filePath)` and verify `resolvedPath.startsWith(path.resolve(clonePath) + sep)` before reading. This follows the same pattern documented in `server/INSIGHTS.md` (entry `2026-08-15` about `resolveAndValidatePath`). Import `sep` from `node:path` (not hardcoded `/`).

3. **Risk: `walkClone` only returns files with SUPPORTED_EXT (.ts/.tsx/.js etc.), not all files.**
   Mitigation: For the onboarding fallback, we need a broader file tree. `walkClone` is used only for the file list shape. The config file reads (`package.json`, `README.md`, etc.) are done separately by explicit path lookup, regardless of `walkClone`'s extension filter. The LLM receives the walk output as "source files" and config files separately.

4. **Risk: Concurrent server restart loses in-memory lock, orphaning a generation.**
   Mitigation: Acceptable for v1 per the spec's open questions. The client's next GET returns 404 (empty state) and the user can retry. Document this in the module's comments.

5. **Risk: Client vendor/shared copy diverges from server copy.**
   Mitigation: Step 3 explicitly creates the file in both locations and updates both barrel exports. The plan mentions this is a physical copy (not a symlink) per INSIGHTS.md.

6. **Risk: 60s LLM timeout may be too short for large repos with slow models.**
   Mitigation: The POST route sets a 65s Fastify timeout via `request.raw.setTimeout(65_000)`. The LLM call uses `timeoutMs: 60_000`. If the model is slow, the user sees a 504 (not 502). They can retry or the admin can switch to a faster model via the feature_models settings.

7. **Risk: Mermaid diagram contains XSS payloads.**
   Mitigation: The existing `MermaidDiagram` component already uses `securityLevel: 'strict'` (line 37 of `MermaidDiagram.tsx`). Mermaid's strict mode renders in a sandboxed SVG. The diagram content is generated by the LLM from repo data (not user-supplied), but defense-in-depth is maintained.

8. **Risk: Partial index state bypasses fallback (degraded map but some PageRank data).**
   Mitigation: The broadened degradation condition (Step 5) checks `indexState.status` and `indexState.degraded` and `indexState.lastIndexedSha`. Any unavailable/degraded/failed state triggers full fallback. A partial index with `status: 'partial'` but a valid `lastIndexedSha` and `degraded` not set will NOT trigger fallback -- this is correct because partial means SOME data IS available, and the individual methods (`getRepoMap`, `getTopFilesByRank`) degrade gracefully on their own (returning empty/degraded results that the LLM can work with).

9. **Risk: Parse-failure sentinel string matching is fragile.**
   Mitigation: Both OpenAI (`openai.ts` line 132) and Anthropic (`anthropic.ts` line 147) adapters use `'failed schema validation'` in their `ExternalServiceError` messages. The service checks `err.message.includes('failed schema validation')`. If a future adapter changes this wording, the service would misclassify parse exhaustion as a network error (502 instead of 500). This is a low-severity risk because: (a) the error is still surfaced to the user (just wrong status code), (b) the no-DB-write guarantee still holds, and (c) a more robust approach (e.g., a custom error subclass for parse exhaustion) could be added later as a cross-cutting improvement to the LLM adapter layer.

## Out of Scope

- **Streaming response** -- deferred to future iteration per spec non-goals.
- **Version history** -- only latest generation stored per spec non-goals.
- **Auto-generation on repo add/sync** -- generation is user-initiated per spec non-goals.
- **Table-of-contents / section navigation** -- flagged as future enhancement in spec.
- **`input_sha` staleness detection UI** -- deferred per spec open questions.
- **External issue tracker integration** -- per spec non-goals.
- **Dependence on Project Context documents** -- per spec non-goals.

## Cross-Review Gap Resolution Summary

| Gap ID | Priority | Resolution |
|--------|----------|------------|
| RF-1 | HIGH | Broadened AC-X3 fallback condition in Step 5: checks `indexState.status`, `.degraded`, and `.lastIndexedSha` -- any unavailable/degraded/failed state triggers fallback. Partial index with valid SHA does NOT trigger fallback (correct, because partial data IS available). |
| RF-2 | HIGH | Clarified retry semantics in Recommendations section and Step 5: `completeStructured` has its own parse-failure retry loop (separate from `withRetry` for network errors). `maxRetries: 1` = 2 parse attempts. Service does NOT add its own retry. |
| RF-3 | HIGH | Steps 1 and 2 now verify `generated_at` has `NOT NULL DEFAULT now()` constraints. Step 1 inspects the Drizzle schema definition; Step 2 verifies constraints in the generated migration and adds ALTER if missing. |
| RF-4 | LOW | Step 3 and Step 6 now include test cases for invalid `language` values (too long, non-alpha) -- rejected by Zod regex `/^[a-zA-Z]{2,5}$/` at the contract level, surfacing as Fastify 400. |
| RF-5 | MEDIUM | Step 9 (SectionBlock) now explicitly documents edge case 8: `defaultBranch` is read from `useActiveRepo()` at render time, not from onboarding JSON. Test case added. |
| RF-6 | MEDIUM | Steps 5 and 11 merged: Step 5 is now the ONLY step that touches `onboarding.system.md`. Step 11 has been removed entirely. The plan explicitly states "This is the ONLY step that touches the prompt file." |
| RF-7 | LOW | Step 9 now confirms sidebar navigation works out-of-the-box: `shell.json` has `"onboarding-tour"` key, `activeKeyFor()` handles `/onboarding` paths. No additional nav work needed. |
| RF-8 | LOW | Architecture Constraints section now confirms `ToastProvider` already renders with `aria-live="polite"` (line 91 of toast.tsx). No changes needed. |
| RF-9 | MEDIUM | Step 3 and Recommendation 5 now explicitly define the `diagram` field as `z.string().nullish()` in the strict schema. Post-parse normalization runs AFTER Zod parse succeeds, enforcing `null` on non-architecture sections. |
| RF-10 | LOW | Step 8 now includes a dedicated unit test for the `useOnboarding` hook's 404-to-null conversion, separate from the component test. |
| RF-A | HIGH | Step 5 error handling rewritten: `TimeoutError` (from `resilience.ts`, `name = 'TimeoutError'`, no `.code` property) is NOT retryable by `defaultIsRetryable` and propagates directly from `completeStructured`. Service catches `TimeoutError` specifically and re-throws as `AppError('llm_timeout', ..., 504)`. Other LLM errors (`ExternalServiceError`) continue to produce 502. Test case added for timeout -> 504 in both Step 5 (unit) and Step 6 (integration). |
| RF-B | LOW | Step 9 adds verification checkbox: confirm `MermaidDiagram.tsx` line 37 still uses `securityLevel: 'strict'`. |
| RF-E | LOW | Step 9 clarifies that `constants.ts` `SECTION_TITLES` is the runtime source for section headings; `onboarding.json` contains section names only in the `generate.body` CTA paragraph, not as keyed display names. |
| RF-F | LOW | Step 7 now enumerates the exact i18n key requiring change: `generate.body` (line 10). All other keys confirmed unchanged. |
| RF-G | LOW | Step 6 now references the Fastify 5 per-route timeout approach: `request.raw.setTimeout(65_000)` (Node.js `http.IncomingMessage.setTimeout()`), since Fastify 5 does not provide a built-in per-route timeout in route shorthand options. |

### Second-Pass Fixes (this revision)

| Fix ID | Priority | Resolution |
|--------|----------|------------|
| RF-1/REQ-37 | HIGH | **HTTP 500 vs 502 on parse-failure exhaustion.** The spec (AC-X1) requires HTTP 500 when both LLM parse attempts are exhausted. Previously the plan let `ExternalServiceError` (502) propagate. Now the service inspects `ExternalServiceError.message` for the sentinel `'failed schema validation'` and re-throws as `AppError('parse_failure', ..., 500)`. Network/provider errors remain 502. Updated: Recommendation 1, Step 5 error handling, Step 5 tests (3 distinct failure tests), Step 6 tests (3 distinct integration tests), Risk Assessment item 1 and new item 9, coverage matrix AC-X1 description. |
| RF-2/REQ-38 | MEDIUM | **Verbatim-identifier constraint for non-English generation.** Step 5 prompt template update now explicitly requires the instruction: "Write all prose, descriptions, and titles in `{{language}}`. Keep all code identifiers, file paths, function names, library names, and technical terms verbatim in their original form regardless of language." |
| RF-3 | MEDIUM | **`getFileFacts()` API surface verification.** Confirmed `getFileFacts()` is NOT on the `RepoIntel` facade interface (only on `RepoIntelRepository`). Step 4 now adds a `getFileFacts` method to `OnboardingRepository` that queries the `file_facts` table directly. Step 5 updated to call `this.repo.getFileFacts()` instead of `container.repoIntel.getFileFacts()`. Architecture Constraints section updated with this finding. |
| RF-5 | LOW | **`request.raw.setTimeout()` socket behavior.** Step 6 POST handler now includes a note that `setTimeout` fires a `'timeout'` event but does not auto-close the socket, and instructs the implementer to verify existing timeout handling or attach a manual handler. |
| RF-6 | LOW | **GET reply schema discriminated union.** Step 6 GET route now includes a note about ensuring the Fastify reply schema accommodates both `OnboardingResponse` and `{ status: 'generating' }` shapes. |
| RF-7 | LOW | **Missing test for edge case 9.** Step 9 component tests now include a test case asserting that during regeneration (mutation pending), old section data is NOT visible -- only the spinner is shown. |
| RF-8 | LOW | **`getIndexState()` return type reference.** Step 5 now includes a detailed reference to `IndexState` in `server/src/modules/repo-intel/types.ts` (lines 43-51) with all property names and types. |
