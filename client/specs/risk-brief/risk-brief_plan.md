# Implementation Plan: Risk Brief

**Spec:** `client/specs/risk-brief/risk-brief.spec.md`
**Scope:** server, client (cross-package)
**Estimated complexity:** high
**Multi-agent execution:** yes (user permission granted)
**Created:** 2026-08-17
**Revised:** 2026-08-17 (cross-review gap closure)

## Contextye
Reviewers currently see IntentCard and BlastCard on the PR Overview tab but must
mentally synthesize risk across intent, blast, findings, and diff data. This feature
adds a single AI-generated PrBriefCard that consolidates what changed, why, risk
level, risk areas with file:line links, and prioritized review focus items. A
mechanically-computed findings/blockers summary row provides at-a-glance triage. The
brief is cached by `(pr_id, head_sha)`, manually generated, and shows a stale badge
when the PR is updated.

Additionally, the smart-diff classifier is extended to populate
`SmartDiffFile.pseudocode_summary` via an LLM call, and the SmartDiffViewer renders
a "What this does" annotation when that field is non-null.

## Requirements Summary

- AI-generated brief card (what, why, risk level, risk areas, review focus) on
  Overview tab above IntentCard/BlastCard.
- Mechanically-computed findings/blockers summary row (not AI-generated).
- File:line links in risk areas and review focus navigate to Files Changed tab.
- Stale badge when `head_sha` changes; manual regenerate only.
- Server caches brief by `(pr_id, head_sha)` in new `pr_risk_brief` table.
- GET returns cached brief, `{ status: 'generating' }`, or 404; POST generates/regenerates.
- LLM output validated against actual PR file list; unrecognized paths stripped
  (with path normalization before comparison).
- In-memory lock prevents concurrent generation for same PR.
- Zero-files PR returns 422 from POST; GET returns null (404).
- SmartDiffViewer renders `pseudocode_summary` annotation per file.
- Smart-diff classifier populates `pseudocode_summary` via LLM.

## Spec Coverage Matrix

| Criterion | EARS Pattern | Plan Step(s) | Status |
|-----------|-------------|--------------|--------|
| AC-U1: PrBriefCard positioned above IntentCard/BlastCard row, full width | Ubiquitous | Step 8 | COVERED |
| AC-U2: Five sections when brief exists (what, why, risk level badge, risk areas, review focus) | Ubiquitous | Step 8 | COVERED |
| AC-U3: Findings/blockers summary row below brief sections | Ubiquitous | Step 8 | COVERED |
| AC-U4: Summary row mechanically computed from findings prop | Ubiquitous | Step 8 | COVERED |
| AC-U5: BriefRiskLevel enum in new contract file | Ubiquitous | Step 1 | COVERED |
| AC-U6: Risk level badge with distinct colors per level | Ubiquitous | Step 8 | COVERED |
| AC-U7: Risk area items with file path + optional line as clickable link | Ubiquitous | Step 8 | COVERED |
| AC-U8: Review focus items with numbered index, file:line link, and note | Ubiquitous | Step 8 | COVERED |
| AC-U9: pr_risk_brief table with composite key (pr_id, head_sha) and JSONB brief | Ubiquitous | Step 2, Step 3 | COVERED |
| AC-E1: "Generate brief" click POSTs to /pulls/:id/brief | Event-Driven | Step 7, Step 8 | COVERED |
| AC-E2: POST assembles inputs internally from DB/services | Event-Driven | Step 4 | COVERED |
| AC-E3: Best-effort assembly when inputs unavailable; optional sources metadata | Event-Driven | Step 4 | COVERED |
| AC-E4: Single structured LLM call returns Brief object | Event-Driven | Step 4 | COVERED |
| AC-E5: Server validates file paths against pr_files, strips invalid, logs warning | Event-Driven | Step 4 | COVERED |
| AC-E6: Persist validated brief to pr_risk_brief and return | Event-Driven | Step 4 | COVERED |
| AC-E7: Client renders brief content replacing skeleton | Event-Driven | Step 8 | COVERED |
| AC-E8: Structured info-level log on completion | Event-Driven | Step 4 | COVERED |
| AC-E9: File:line link navigates to diff tab with query params | Event-Driven | Step 8 | COVERED |
| AC-E10: "Regenerate" keeps old brief visible with overlay spinner | Event-Driven | Step 8 | COVERED |
| AC-E11: pseudocode_summary annotation in SmartDiffViewer | Event-Driven | Step 10 | COVERED |
| AC-S1: Never-generated state shows empty card with "Generate brief" button | State-Driven | Step 8 | COVERED |
| AC-S2: In-progress shows skeleton loading state | State-Driven | Step 7, Step 8 | COVERED |
| AC-S3: Regeneration shows previous brief with overlay spinner | State-Driven | Step 8 | COVERED |
| AC-S4: Stale brief shows "Outdated" badge and enabled "Regenerate" button | State-Driven | Step 8 | COVERED |
| AC-S5: Button disabled during in-flight request | State-Driven | Step 7, Step 8 | COVERED |
| AC-OF1: Smart-diff classifier populates pseudocode_summary via LLM | Optional Feature | Step 9 | COVERED |
| AC-X1: POST failure shows toast, card remains in prior state | Unwanted | Step 7, Step 8 | COVERED |
| AC-X2: Invalid file paths stripped and logged | Unwanted | Step 4 | COVERED |
| AC-X3: Prompt caps at 10 risks, 15 review focus items | Unwanted | Step 6 | COVERED |
| AC-X4: Concurrent POST rejected via in-memory lock (mutex substituted for route-level rate limiting — see Recommendations #8) | Unwanted | Step 4 | COVERED |
| EC-7: Zero-files PR returns error/empty brief | Edge Case | Step 4 | COVERED |
| EC-10: In-progress state on navigation return | Edge Case | Step 1, Step 4, Step 7, Step 8 | COVERED |
| REQ-44/REQ-49: Plain-text rendering of what/why | NFR Security | Step 8 | COVERED |
| REQ-45: Accessible buttons | NFR Accessibility | Step 8 | COVERED |
| REQ-46: Badge text label (not color-only) | NFR Accessibility | Step 8 | COVERED |
| REQ-47: Keyboard-navigable file:line links | NFR Accessibility | Step 8 | COVERED |
| REQ-48: aria-label on overlay spinner | NFR Accessibility | Step 8 | COVERED |

## Recommendations Applied

1. **GET+POST pattern** (like onboarding) -- GET returns cached brief or 404, POST
   generates/regenerates. Approved.
2. **hardenSystemPrompt + wrapUntrusted** from reviewer-core for prompt security.
   Approved.
3. **Prompt template file** (`risk-brief.system.md` in `src/prompts/`). Approved.
4. **New `prRiskBrief` table** in existing `reviews.ts` schema file alongside
   `prIntent` and `prBrief`. Approved.
5. **GET returns `{ status: 'generating' }` with polling** (onboarding pattern) to
   handle navigate-away-and-return during generation (EC-10). Chosen over 202 Accepted
   because it matches the established onboarding module pattern exactly.
6. **Zero-files PR returns 422** from POST (not an empty brief) because there is no
   meaningful content to analyze (EC-7).
7. **Path normalization** before file validation: strip leading `./`, normalize
   separators to `/`, lowercase comparison (RF-9/GAP-11).
8. **In-memory lock substituted for rate limiting (AC-X4/EC-6):** The spec says
   "standard per-route rate limiting." This plan uses an in-memory application
   mutex (`Map<string, Promise>` + 75s TTL) instead, matching the onboarding
   module pattern. Rationale: a rate limiter throttles request volume; the actual
   requirement is per-resource exclusivity (prevent two simultaneous generations
   for the same PR). A mutex is semantically correct for this use case, whereas a
   request-rate limiter would not prevent a second request after the first one
   clears the limit window. The 409 response satisfies EC-6's "rejected with
   appropriate HTTP status; client shows toast." Known limitation: the mutex is
   process-local and does not guard against concurrent generation across multiple
   server instances (see Risk 5). Acceptable for v1 — same trade-off as
   onboarding.

## Architecture Constraints

- `vendor/shared/` -- extend with new files only, never edit existing contracts.
  Source: root `CLAUDE.md`, server `CLAUDE.md`.
- Modules registered statically in `server/src/modules/index.ts`. Source: root
  `CLAUDE.md`.
- Migrations NOT applied on boot -- plan must include migration step. Source: root
  `CLAUDE.md`.
- `reviewer-core` consumed as raw TypeScript source. Source: root `CLAUDE.md`.
- Routes -> Service -> Repository is the established onion pattern. Source: server
  `INSIGHTS.md` (2026-08-07 entry).
- Drizzle ORM operators belong exclusively in Repository layer. Source: server
  `INSIGHTS.md` (2026-08-15 entry).
- `vendor/shared/` is a physical copy between server and client -- new contract
  files must be copied to both and barrel-exported in both. Source: client
  `INSIGHTS.md` (2026-08-06 entry).
- `apiFetch` only sends `content-type: application/json` when body is present --
  body-less POST works correctly. Source: client `CLAUDE.md`.
- Fastify body-less POST with Zod schema requires optional union wrapper. Source:
  server `INSIGHTS.md` (2026-08-17 entry).
- `req.raw.setTimeout()` not available in Fastify `inject()` -- guard with
  `typeof` check. Source: server `INSIGHTS.md` (2026-08-17 entry).
- Drizzle destructured `const [row]` does not narrow to non-undefined after guard;
  use `rows[0]` pattern. Source: server `INSIGHTS.md` (2026-08-17 entry).
- `risk_brief` already exists in `FeatureModelId` enum and `FEATURE_MODELS`
  registry. Source: `server/src/vendor/shared/contracts/platform.ts:59-64`.

## Pre-implementation Checklist

- [x] Migration needed? Yes -- new `pr_risk_brief` table.
- [x] New module needed? Yes -- `risk-brief` module, register in `modules/index.ts`.
- [x] New shared contracts needed? Yes -- new `brief-response.ts` in `vendor/shared/contracts/`.
- [ ] New adapter needed? No -- uses existing `LLMProvider` via container.

## Steps

### Step 1: Create shared contract `brief-response.ts`

**Package:** server (then copy to client)
**Files:**
- `server/src/vendor/shared/contracts/brief-response.ts` (create)
- `server/src/vendor/shared/index.ts` (modify -- add barrel export)
- `client/src/vendor/shared/contracts/brief-response.ts` (create -- copy)
- `client/src/vendor/shared/index.ts` (modify -- add barrel export)

**What:** Define the Zod schemas and inferred types for the risk brief API contract:
- `BriefRiskLevel` -- `z.enum(['low', 'medium', 'high', 'critical'])`. Separate
  from the existing `RiskSeverity` in `brief.ts` (which is `['high', 'medium', 'low']`
  without `'critical'`).
- `BriefFileRef` -- `z.object({ file: z.string(), line: z.number().int().optional() })`.
- `BriefRiskArea` -- `z.object({ title: z.string(), description: z.string(), file_refs: z.array(BriefFileRef) })`.
- `BriefReviewFocusItem` -- `z.object({ file: z.string(), line: z.number().int().optional(), note: z.string() })`.
- `Brief` -- `z.object({ what: z.string(), why: z.string(), risk_level: BriefRiskLevel, risks: z.array(BriefRiskArea), review_focus: z.array(BriefReviewFocusItem) })`.
  This is the schema passed to `completeStructured`.
- `BriefSources` -- `z.object({ has_intent: z.boolean(), has_blast: z.boolean(), has_linked_issue: z.boolean(), has_context_docs: z.boolean(), context_doc_count: z.number().int() })`.
- `RiskBriefResponse` -- `z.object({ brief: Brief, head_sha: z.string(), sources: BriefSources.optional(), model: z.string(), generated_at: z.string() })`.
  **REQ-52 (array size caps):** `Brief.risks` and `Brief.review_focus` are defined as plain `z.array(...)` without `.max()`. The prompt engineering cap (10 risks, 15 review focus) is the sole enforcement mechanism. Optional Zod `.max()` constraints noted in the spec are consciously omitted here — the prompt cap is sufficient and adding `.max()` would silently discard items rather than raising an actionable error. If future audits reveal the LLM consistently exceeds the cap, add `.max(10)` / `.max(15)` to these arrays.
  This is the API response shape returned by GET and POST when a brief exists.
- `RiskBriefGeneratingResponse` -- `z.object({ status: z.literal('generating') })`.
  Returned by GET when the in-memory generation lock is held (EC-10). This follows
  the onboarding module's `OnboardingGeneratingResponse` pattern exactly.

Export both `RiskBriefResponse` and `RiskBriefGeneratingResponse` types via
`z.infer<>`.

After creating in server, physically copy the file to
`client/src/vendor/shared/contracts/brief-response.ts` and add
`export * from './contracts/brief-response.js';` to both barrel `index.ts` files.

**Skills:** `zod`, `typescript-expert`
**Tests:** Unit test not needed for pure Zod schema declarations (covered by consumer tests).
**Depends on:** none
**Addresses:** AC-U5, EC-10 (contract)

---

### Step 2: Add `prRiskBrief` table to Drizzle schema

**Package:** server
**Files:** `server/src/db/schema/reviews.ts` (modify), `server/src/db/schema.ts` (modify)

**What:** Add the `prRiskBrief` table definition to `reviews.ts` (where `prIntent`
and `prBrief` already live):

```
prRiskBrief = pgTable('pr_risk_brief', {
  prId:      uuid('pr_id').notNull().references(() => pullRequests.id, { onDelete: 'cascade' }),
  headSha:   text('head_sha').notNull(),
  brief:     jsonb('brief').notNull(),
  model:     text('model').notNull(),
  sources:   jsonb('sources'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  pk: primaryKey({ columns: [t.prId, t.headSha] }),
}))
```

Composite PK on `(pr_id, head_sha)` per spec. JSONB `brief` column stores the
`Brief` object. `sources` stores optional `BriefSources`. `model` stores the LLM
model used.

Add `prRiskBrief` to the `schema` object export and the named import list in
`server/src/db/schema.ts`.

**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`
**Tests:** Covered by the migration generation and integration tests in Step 5.
**Depends on:** none
**Addresses:** AC-U9

---

### Step 3: Generate and apply migration

**Package:** server
**Files:** `server/src/db/migrations/0015_*.sql` (auto-generated)

**What:** Run `pnpm db:generate` to generate the Drizzle migration for the new
`pr_risk_brief` table. Then run `pnpm db:migrate` to apply. Verify the generated
SQL creates the table with the composite primary key and FK constraint on `pr_id`.

The generated migration should contain:
- `CREATE TABLE "pr_risk_brief" (...)` with composite PK.
- FK constraint referencing `pull_requests(id)` with `ON DELETE CASCADE`.

**Skills:** `drizzle-orm-patterns`, `postgresql-table-design`
**Tests:** Migration verified by `pnpm db:migrate` succeeding.
**Depends on:** Step 2
**Addresses:** AC-U9

---

### Step 4: Create `risk-brief` module (repository + service + routes)

**Package:** server
**Files:**
- `server/src/modules/risk-brief/repository.ts` (create)
- `server/src/modules/risk-brief/service.ts` (create)
- `server/src/modules/risk-brief/routes.ts` (create)
- `server/src/modules/index.ts` (modify -- add import + registry entry)
- `server/src/platform/container.ts` (modify -- add lazy `riskBrief` getter)

**What:** Create the three-layer module following the onboarding pattern.

**4a. Repository (`repository.ts`):**
- `RiskBriefRepository` class with `constructor(private db: Db)`.
- `getByPrIdAndSha(prId, headSha)` -- select from `prRiskBrief` where
  `(prId, headSha)` match. Returns row or null.
- `getLatestByPrId(prId)` -- select the most recent brief for a PR (any
  head_sha), ordered by `created_at DESC`, limit 1. Returns row or null. Used by
  GET to return the cached brief even when head_sha has changed (stale state).
  **DTO mapping (GAP-9/RF-10):** Both `getLatestByPrId` and `getByPrIdAndSha`
  must map the DB row's `createdAt` (Drizzle `Date` object from the `timestamptz`
  column) to `generated_at: string` in ISO 8601 format
  (`row.createdAt.toISOString()`). The repository return type must include
  `generated_at: string` (not `createdAt: Date`) so the service layer works with
  the DTO shape that matches the `RiskBriefResponse` contract.
- `upsert(prId, headSha, data)` -- insert/onConflict update on `(prId, headSha)`.
  Returns the upserted row, also mapping `createdAt` to `generated_at` as above.
- `getPrForWorkspace(workspaceId, prId)` -- select from `pullRequests` joined
  with workspace ownership check. Returns PR row (id, headSha, additions,
  deletions, filesCount, body, repoId) or null.
- `getPrFilePaths(prId)` -- select `path` from `pr_files` where `pr_id = prId`.
  Returns `string[]`. Used for LLM output validation and zero-files check.
- `getIntentForPr(prId)` -- select from `pr_intent` where `pr_id = prId`.
  Returns intent data or null. (Reading from another domain's table is acceptable
  for a read-only cross-cutting query in the repository layer.)
- `getBlastSummaryForPr(prId)` -- select `json` from `pr_brief` where
  `pr_id = prId`. Extract and return `blast.summary` string from the JSONB, or
  null.

Use the `rows[0]` narrowing pattern (not destructuring) per INSIGHTS.md.

**4b. Service (`service.ts`):**
- `RiskBriefService` class with `constructor(private container: Container)`,
  instantiating `RiskBriefRepository` internally.
- In-memory lock (`Map<string, Promise>`) following the onboarding pattern, with
  75s TTL safety net. Keyed by `prId`.
- `getBrief(workspaceId, prId)` -- validate workspace ownership, check lock
  (return `{ status: 'generating' }` if held), query repo for latest brief.
  Return `RiskBriefResponse | RiskBriefGeneratingResponse | null`. The return
  type uses the `RiskBriefGeneratingResponse` from the contract (Step 1) so the
  GET handler can distinguish between "generating", "exists", and "not found"
  states. This directly handles EC-10 (navigate-away-and-return).
- `generateBrief(workspaceId, prId)` -- validate workspace, check lock (throw
  409 if held), acquire lock, call `doGenerate`, release lock in `.finally()`.
- `doGenerate(workspaceId, prId, prRow)` -- private method:
  1. Gather inputs: intent (from repo), blast summary (from repo), diff stats
     (from PR row), linked issue body (from PR row `body` -- extract issue
     number, fetch via GitHub adapter best-effort), PR file paths (from repo),
     project context docs (from `container.projectContext` if an agent is
     available -- best-effort, skip if no agent configured).
     **Linked issue body (RF-D):** The PR `body` field may contain a closing
     keyword linking to an issue (e.g., "Closes #42"). Extract the issue
     number with a regex (`/(?:closes?|fixes?|resolves?)\s+#(\d+)/i`). Before
     writing the call, open `server/src/adapters/github.ts` and locate the
     method that fetches issue details — it may be named `getIssue`,
     `fetchIssue`, or similar. If a body-only method does not exist, call the
     full issue method and extract `.body`. If the GitHub adapter is not
     available or the call fails, set `linkedIssueBody = null` and mark
     `has_linked_issue: false` in `BriefSources`. Never throw. Add the adapter
     file to Step 4's Files list only if a new method must be added.
     **Project context docs (RF-E):** Before writing the call, open
     `server/src/modules/project-context/` and identify the service class and
     method that returns context documents for an agent (it may be
     `ProjectContextService.getContextDocs(agentId)`,
     `getSpecsForAgent(agentId)`, or similar). Confirm the return type
     (expected: an array of document objects with a `content` string field).
     If no agent is configured for the workspace, set `has_context_docs: false`,
     `context_doc_count: 0` and skip. Never throw. Add the project-context
     service file to Step 4's Files list only if its interface must be extended.
  2. **Zero-files guard (EC-7/GAP-1):** After fetching PR file paths, if
     `prFilePaths.length === 0`, throw
     `new AppError('no_files', 'PR has no files to analyze', 422)`. This
     returns a 422 to the client. The client toast handler displays this as
     "PR has no files to analyze" and the card remains in its prior state
     (never-generated empty card or stale brief). This is chosen over
     returning a shallow brief because there is genuinely nothing to analyze.
  3. Track which inputs were present in a `BriefSources` object.
  4. Resolve model via `resolveFeatureModel(container, workspaceId, 'risk_brief')`.
  5. Build system prompt via `renderPrompt('risk-brief.system.md', {})` and
     `hardenSystemPrompt()`.
  6. Build user message assembling all gathered inputs, wrapping each with
     `wrapUntrusted()`.
  7. Call `llm.completeStructured<Brief>()` with the `Brief` schema,
     temperature 0.3, maxTokens 4096, maxRetries 1, timeoutMs 60_000.
  8. Post-validate: filter `risks[].file_refs` and `review_focus[].file`
     against the actual PR file paths. **Path normalization (GAP-11/RF-9):**
     Before comparing LLM-returned file paths against the PR file list,
     normalize both sides: strip leading `./`, normalize path separators to
     forward slashes (`/`), and perform case-insensitive comparison
     (`path.toLowerCase()`). Build a `Set` of normalized PR file paths for
     O(1) lookup. Strip entries whose normalized file path is not in the
     normalized PR file set. Log a warning for each stripped path, including
     both the original LLM path and the attempted normalized form.
  9. Persist to DB via `repo.upsert(prId, headSha, { brief, model, sources })`.
  10. Emit structured info log with model, tokens, latency, inputs_present,
      file_refs_stripped count.
      **Token usage sourcing (RF-C):** Before writing the service, check whether
      `LLMProvider.completeStructured` currently returns
      `{ result: T, usage: { prompt_tokens: number, completion_tokens: number } }`
      or just `T`. If it returns only `T`, extending the return type is a
      cross-package change — `LLMProvider` is defined in `reviewer-core` (consumed
      as raw TypeScript source) and may be called by the review agent and
      onboarding module. Treat this as a **prerequisite step before Step 4**:
      (a) locate `completeStructured` in `reviewer-core/src/`, (b) if usage is
      absent, add `usage` to its return type and thread the Anthropic SDK's
      `usage.input_tokens` / `usage.output_tokens` through, (c) verify existing
      callers still compile. If extending would be too disruptive, log
      `prompt_tokens: null, completion_tokens: null` as a fallback and open a
      follow-up to add usage tracking later.
  11. Return `RiskBriefResponse` DTO.
- Error handling follows onboarding pattern: TimeoutError -> 504, parse
  exhaustion -> 500, other ExternalServiceError -> 502.

**4c. Routes (`routes.ts`):**
- Default export: `async function riskBriefRoutes(appBase: FastifyInstance)`.
- `GET /pulls/:id/brief` -- call `getContext`, call `service.getBrief()`.
  If result is null, throw 404. If result has `status === 'generating'`,
  return 200 with `{ status: 'generating' }`. Otherwise return 200 with the
  `RiskBriefResponse` body. Both non-null shapes are valid 200 responses
  (polymorphic 200, matching the onboarding pattern -- omit Fastify response
  schema so the serializer does not strip fields).
- `POST /pulls/:id/brief` -- call `getContext`, set 65s socket timeout (with
  `typeof req.raw.setTimeout === 'function'` guard), call
  `service.generateBrief()`. Return 200 with brief.
- Body schema for POST: optional (body-less POST accepted) using the same
  `z.union([..., z.undefined(), z.null()]).optional()` pattern from onboarding.

**4d. Module registration:**
- Add `import riskBrief from './risk-brief/routes.js';` to `modules/index.ts`.
- Add `riskBrief` entry to the `modules` record.

**4e. Container:**
- Add `private _riskBrief?: RiskBriefService` and lazy getter
  `get riskBrief(): RiskBriefService` to `Container` class, following the
  `onboarding` pattern.

**Skills:** `fastify-best-practices`, `drizzle-orm-patterns`, `typescript-expert`,
`security`, `onion-architecture`
**Tests:** See Step 5 for tests.
**Depends on:** Step 1, Step 2, Step 3
**Addresses:** AC-E1, AC-E2, AC-E3, AC-E4, AC-E5, AC-E6, AC-E8, AC-S1, AC-X2,
AC-X4, EC-7, EC-10 (server side)

---

### Step 5: Write server tests

**Package:** server
**Files:**
- `server/src/modules/risk-brief/service.test.ts` (create)
- `server/src/modules/risk-brief/routes.it.test.ts` (create)

**What:**

**5a. Unit tests (`service.test.ts`):**
- Test file path validation: given LLM output with paths not in PR file list,
  verify they are stripped from `risks[]` and `review_focus[]`.
- Test path normalization: given LLM output with `./src/auth.ts` and PR file
  list containing `src/auth.ts` (no leading `./`), verify the path is NOT
  stripped. Test case-insensitive matching similarly.
- Test concurrent lock: second call throws 409.
- Test best-effort input assembly: when intent/blast/body are all null, service
  still calls LLM and returns a brief.
- Test error mapping: TimeoutError -> 504, parse exhaustion -> 500.
- **Test zero-files guard (EC-7/GAP-1):** When `getPrFilePaths` returns an
  empty array, `doGenerate` throws `AppError` with status 422 and message
  "PR has no files to analyze". Verify the LLM is NOT called.
- **Test `generated_at` mapping (GAP-9):** Verify that the repository DTO
  maps `createdAt` (Date) to `generated_at` (ISO 8601 string).
- **Test `{ status: 'generating' }` return (EC-10):** When the in-memory lock
  is held, `getBrief` returns `{ status: 'generating' }`, not null.

Mock: `Container` with mock LLM, mock DB (via repository mock or in-memory).

**5b. Integration tests (`routes.it.test.ts`):**
- `GET /pulls/:id/brief` returns 404 when no brief exists.
- `POST /pulls/:id/brief` generates a brief and returns 200 (with mocked LLM).
- `GET /pulls/:id/brief` returns 200 after generation.
- `POST /pulls/:id/brief` while lock held returns 409.
- Verify response shape matches `RiskBriefResponse` contract, including
  `generated_at` as an ISO 8601 string.
- Verify stale detection: response includes `head_sha` for client comparison.
- **Test zero-files POST (EC-7):** Insert a PR with zero files, POST returns 422
  with error message.

Use Fastify `inject()` pattern. Assert 422 (not 400) for Zod body validation
failures per INSIGHTS.md.

**Skills:** `fastify-best-practices`, `typescript-expert`
**Tests:** Self-referential.
**Depends on:** Step 4
**Addresses:** AC-E2, AC-E3, AC-E5, AC-E6, AC-X2, AC-X4, EC-7, EC-10

---

### Step 6: Create prompt template `risk-brief.system.md`

**Package:** server
**Files:** `server/src/prompts/risk-brief.system.md` (create)

**What:** Create the system prompt template for risk brief generation. The prompt
instructs the LLM to:
- Analyze the PR's intent, blast radius, diff stats, linked issue, and context
  docs.
- Return a structured `Brief` object with `what`, `why`, `risk_level`, `risks[]`,
  and `review_focus[]`.
- Cap at 10 risk areas and 15 review focus items (AC-X3).
- Use only file paths that exist in the provided file list.
- Assign `risk_level` based on the severity and breadth of changes.
- Write concise, reviewer-oriented prose (not developer-oriented).
- Focus `review_focus` items on the highest-risk files first.

The template uses no `{{var}}` placeholders (all dynamic data assembled in code
via `wrapUntrusted`).

**Skills:** `security` (prompt injection defense via `hardenSystemPrompt`)
**Tests:** Prompt content is validated indirectly by service/integration tests.
**Depends on:** none
**Addresses:** AC-X3, AC-E4

---

### Step 7: Create client hooks for risk brief

**Package:** client
**Files:** `client/src/lib/hooks/risk-brief.ts` (create),
`client/src/lib/hooks/index.ts` (modify -- add barrel export)

**What:** Create TanStack Query hooks following the onboarding pattern:

- Define a union type for the GET response:
  `type RiskBriefData = RiskBriefResponse | RiskBriefGeneratingResponse | null`.
  This mirrors `OnboardingData` from the onboarding hook.

- `useRiskBrief(prId)` -- `useQuery<RiskBriefData>` with key `["risk-brief", prId]`.
  Calls `api.get<RiskBriefResponse | RiskBriefGeneratingResponse>('/pulls/${prId}/brief')`.
  Returns null on 404 (not-yet-generated state). Does not retry on 404.
  **Polling for in-progress state (EC-10/GAP-2):** Add `refetchInterval` that
  polls every 3s when the response is `{ status: 'generating' }`, matching the
  onboarding hook pattern:
  ```
  refetchInterval: (query) => {
    const d = query.state.data;
    return d != null && 'status' in d && d.status === 'generating' ? 3_000 : false;
  }
  ```
  This handles the navigate-away-and-return case: if the user leaves during
  generation, the GET on return will see `{ status: 'generating' }` (lock still
  held) or the completed brief (lock released, brief in DB). Polling bridges
  the gap until the lock releases.

- `useGenerateRiskBrief(prId)` -- `useMutation` calling
  `api.post<RiskBriefResponse>('/pulls/${prId}/brief')`. On success, invalidates
  `["risk-brief", prId]` query. On error, shows toast via `notify.error()`.
  On 409, show specific "Generation already running" message.
  On 422, show "PR has no files to analyze" message (EC-7 client handling).
  On other errors, show generic "Brief generation failed. Please try again."
  Also invalidate `["risk-brief", prId]` on error (as onboarding does) so the
  query refetches and picks up the current server state.

Add `export * from "./risk-brief";` to the hooks barrel `index.ts`.

**Skills:** `react-best-practices`, `typescript-expert`
**Tests:** Hooks are tested indirectly through component tests in Step 8.
**Depends on:** Step 1 (contract types)
**Addresses:** AC-E1, AC-S2, AC-S5, AC-X1, EC-7 (client toast), EC-10 (client polling)

---

### Step 8: Create PrBriefCard component and integrate into OverviewTab

**Package:** client
**Files:**
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/PrBriefCard/PrBriefCard.tsx` (create)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/PrBriefCard/index.ts` (create)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/PrBriefCard/constants.ts` (create)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/PrBriefCard/styles.ts` (create)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/PrBriefCard/helpers.ts` (create)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/PrBriefCard/PrBriefCard.test.tsx` (create)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` (modify)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/styles.ts` (modify)
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (modify)

**What:**

**8a. PrBriefCard component:**
Props: `prId: string`, `headSha: string`, `allFindings: FindingRecord[]`.

States (managed internally via hooks + derived state):
- **Never generated:** `useRiskBrief` returns null and no mutation pending.
  Show empty card with "Generate brief" button.
- **Generating (first time, local trigger):** `useGenerateRiskBrief.isPending`
  and no prior brief. Show skeleton.
- **Generating (server-side, navigate-back):** `useRiskBrief` returns
  `{ status: 'generating' }`. Show skeleton. The polling in `useRiskBrief`
  will auto-refetch until the brief is ready. **(EC-10/GAP-2)**
- **Brief loaded:** `useRiskBrief` returns data with `brief` field. Render
  five sections.
- **Stale:** Brief's `head_sha` !== prop `headSha`. Show "Outdated" badge +
  "Regenerate" button.
- **Regenerating:** `useGenerateRiskBrief.isPending` and prior brief exists.
  Show previous brief with semi-transparent overlay spinner. Regenerate button
  disabled.

Derive the active state by checking the hook return value:
```
const data = useRiskBrief(prId);   // RiskBriefData
const isServerGenerating = data != null && 'status' in data && data.status === 'generating';
const brief = data != null && 'brief' in data ? data : null;
```

Sections when brief exists:
1. **Header row:** Title "Risk Brief", risk level badge (color-coded), and
   Regenerate/Generate button.
2. **"What changed":** Rendered as plain `<p>` element from `brief.what`.
   **Plain-text only (GAP-7/REQ-44/REQ-49):** Do NOT use `react-markdown`,
   `dangerouslySetInnerHTML`, or any HTML/markdown-interpreting renderer.
   The `what` and `why` fields contain LLM-generated text that must be
   rendered as escaped plain text to prevent XSS.
3. **"Why":** Rendered as plain `<p>` element from `brief.why`. Same
   plain-text-only constraint as "What changed".
4. **Risk areas:** List of `brief.risks[]`. Each shows title, description,
   and file:line links. **Links must be `<a>` or `<button>` elements
   (GAP-5/REQ-47)**, not `<span onClick>` or `<div onClick>`, ensuring
   keyboard navigation via Tab and activation via Enter/Space. Links use
   `handleFileClick` pattern from BlastCard (`useRouter` + `usePathname` +
   `useSearchParams` to set `?tab=diff&file=<path>&line=<line>`).
5. **Review focus:** Numbered list of `brief.review_focus[]`. Each shows
   index, file:line link (also `<a>` or `<button>`, same as risk areas),
   and note text.

**Accessibility requirements integrated into component (GAP-3 through GAP-6):**
- **(GAP-3/REQ-45):** "Generate brief" and "Regenerate" buttons must be native
  `<button>` elements (not `<div onClick>`), ensuring keyboard focusability and
  Enter/Space activation without extra ARIA attributes.
- **(GAP-5/REQ-47):** Risk area and review focus file:line links must be `<a>`
  or `<button>` elements, not `<span onClick>`, ensuring keyboard navigation.
- **(GAP-6/REQ-48):** The overlay spinner rendered during regeneration must
  include `aria-label="Regenerating brief..."` (or equivalent descriptive label)
  on the spinner container element.

**Findings/blockers summary row** (below the brief sections):
- Computed from `allFindings` prop (not from brief).
- Count critical-severity findings (blockers) and total findings.
- Display: "N blockers / M total findings" with appropriate styling.
- If no findings, show "No findings yet".

**8b. constants.ts:**
- `RISK_LEVEL_COLORS: Record<BriefRiskLevel, { color: string; bg: string }>` --
  low=green, medium=yellow, high=orange, critical=red, using CSS variables.
- `RISK_LEVEL_LABELS: Record<BriefRiskLevel, string>` -- maps each level to
  its display label (`'LOW'`, `'MEDIUM'`, `'HIGH'`, `'CRITICAL'`).
  **(GAP-4/REQ-46):** The risk level badge must render both the color indicator
  AND a visible text label (e.g., "HIGH", "CRITICAL") so it is not color-only.
  Color alone is insufficient for accessibility.

**8c. helpers.ts:**
- `countBlockers(findings: FindingRecord[]): number` -- count where
  `severity === 'CRITICAL'`.
- `parseFileLine(ref: string): { file: string; line?: number }` -- parse
  `file:line` format if needed.
- `isGeneratingResponse(data: RiskBriefData): data is RiskBriefGeneratingResponse`
  -- type guard for the polymorphic GET response.
- `isBriefResponse(data: RiskBriefData): data is RiskBriefResponse` -- type
  guard for brief data.

**8d. styles.ts:**
- Card styles matching IntentCard/BlastCard patterns (border, border-radius,
  bg-elevated, padding).
- Overlay spinner styles for regeneration state. The overlay container must
  include `aria-label="Regenerating brief..."` **(GAP-6/REQ-48)**.

**8e. OverviewTab changes:**
- Import `PrBriefCard`.
- Accept new props: `headSha: string`, `allFindings: FindingRecord[]`.
- Render `<PrBriefCard>` above the `cardsRow` div containing IntentCard and
  BlastCard.
- Update `styles.ts` if needed (the brief card is full-width, not in the
  2-column grid).

**8f. page.tsx changes:**
- Pass `headSha={pr.head_sha}` and `allFindings={allFindings}` to
  `<OverviewTab>`.
  **`head_sha` availability (RF-B):** Confirm that `pr.head_sha` is already
  present in the PR data fetched by `page.tsx` (check the existing `usePr` or
  equivalent hook return shape). If `head_sha` is not in the current data
  shape, add it to the server-side PR query and the shared PR contract. Do not
  assume it is available without verifying the existing type.
  **`allFindings` sourcing (RF-8):** Check whether `page.tsx` already fetches
  findings data (e.g., via `usePrReviews()` or a dedicated findings hook used
  by `FindingsTab`). If `allFindings: FindingRecord[]` is already computed and
  available in the page-level component tree, thread it down as a prop. If it
  is not yet available at the page level, add a `useFindings(prId)` query call
  (or reuse the existing hook that `FindingsTab` uses) at the page level and
  pass the result. Do not add a second independent network request if the data
  is already fetched elsewhere on the same page.

**8g. PrBriefCard.test.tsx:**
- Test never-generated state renders "Generate brief" button.
- Test brief-loaded state renders all five sections.
- Test findings summary row counts correctly.
- Test stale state shows "Outdated" badge.
- **Test server-generating state (EC-10/GAP-2):** When `useRiskBrief` returns
  `{ status: 'generating' }`, verify the skeleton loading state is rendered
  (not the never-generated empty card).
- **(GAP-7/REQ-44/REQ-49):** Assert that `brief.what` and `brief.why` text is
  rendered within `<p>` or `<span>` elements. Assert that no `react-markdown`
  `Markdown` component wraps these fields (e.g., query for the rendered text
  and verify its parent is a plain element, not a markdown container).
- **(GAP-8/EC-4):** Test first-generation POST failure: after `useGenerateRiskBrief`
  rejects, verify the "Generate brief" button is re-enabled, skeleton is removed,
  and the card is back in never-generated state.
- **(GAP-8/EC-5):** Test regeneration POST failure: after `useGenerateRiskBrief`
  rejects with a prior brief existing, verify the overlay spinner is removed,
  the previous brief is fully visible, and the "Regenerate" button is re-enabled.
- **(GAP-4/REQ-46):** Test that risk level badge renders a visible text label
  (e.g., "HIGH"), not just a colored element.
- **(EC-9):** Test that the findings/blockers summary row reflects the
  `allFindings` prop value, not anything from the cached brief. Render the
  component with a brief that has no findings reference, but pass
  `allFindings` containing 3 critical findings. Assert the summary row shows
  "3 blockers". Then re-render with updated `allFindings` (1 critical) and
  assert the row updates to "1 blocker". This verifies the row is always
  driven by the prop, not stale cached brief data.
- Mock `useRiskBrief` and `useGenerateRiskBrief` hooks.

**Skills:** `react-best-practices`, `react-frontend-best-practices`,
`typescript-expert`, `react-testing-library`
**Tests:** `PrBriefCard.test.tsx`
**Depends on:** Step 1 (contract), Step 7 (hooks)
**Addresses:** AC-U1, AC-U2, AC-U3, AC-U4, AC-U6, AC-U7, AC-U8, AC-E1, AC-E7,
AC-E9, AC-E10, AC-S1, AC-S2, AC-S3, AC-S4, AC-S5, AC-X1, EC-10,
REQ-44, REQ-45, REQ-46, REQ-47, REQ-48, REQ-49

---

### Step 9: Populate `pseudocode_summary` in the smart-diff classifier

**Package:** server
**Files:**
- `server/src/modules/pulls/classifier.ts` (modify)
- `server/src/modules/pulls/classifier.test.ts` (modify)

**What:** Add an LLM-powered step to `buildSmartDiff` (or a new wrapper function
called by the route/service) that populates `pseudocode_summary` for each file.

Approach: After the deterministic classification builds the `SmartDiff` groups,
make a single batched LLM call that receives all file paths + their patch
content and returns a `Record<filePath, summary>`. The classifier itself is
currently pure (no dependencies); to keep the pure `buildSmartDiff` function
intact, create a new `enrichSmartDiffSummaries(smartDiff, patches, container,
workspaceId)` function that:
1. Collects core + wiring files (skip boilerplate -- they don't need summaries).
2. Builds a user message listing each file path + its patch (truncated to a
   reasonable size, wrapped with `wrapUntrusted`).
3. Calls `completeStructured` with a schema `z.object({ summaries: z.array(z.object({ file: z.string(), summary: z.string() })) })`.
4. Merges the summaries back into the `SmartDiffFile` objects by file path.
5. Files not returned by the LLM keep `pseudocode_summary: null`.

This function is called from the route or service layer that already has access
to the Container and patches, not from the pure `buildSmartDiff`.

**`SmartDiffFile` type location (RF-10):** `SmartDiffFile` is defined in
`server/src/vendor/shared/contracts/brief.ts` (the existing shared contract).
The `pseudocode_summary?: string | null` field already exists on that type
(the field was defined but the classifier always set it to `null`). Confirm
this before writing `enrichSmartDiffSummaries` — do not add a duplicate field.
Because this field already exists in the shared contract and the client
`vendor/shared/` copy already includes it, **no contract change or vendor
re-copy is needed for this step**.

The existing `buildSmartDiff` unit test for `pseudocode_summary: null` stays valid
(the pure function still sets null; enrichment is a separate step).

Add a new test for `enrichSmartDiffSummaries` that mocks the LLM and verifies
summaries are merged correctly.

**Skills:** `typescript-expert`, `zod`, `security`
**Tests:** New unit test for `enrichSmartDiffSummaries` in `classifier.test.ts`.
**Depends on:** none (independent of brief steps)
**Addresses:** AC-OF1

---

### Step 10: Render `pseudocode_summary` in SmartDiffViewer

**Package:** client
**Files:**
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.tsx` (modify)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.test.tsx` (modify)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/styles.ts` (modify)

**What:** In the `SmartDiffViewer` component, for each file rendered via
`FileCard`, check `smartFile.pseudocode_summary`. If non-null, render a "What
this does" annotation element immediately below the `FileCard`'s `<div>` wrapper
(or pass it as a new optional prop to `FileCard` for rendering in the file
header area).

**Annotation placement decision (RF-H):** Use the sibling `<div>` approach —
render a small annotation `<div>` immediately after the `<FileCard>` element
within the existing `ref` wrapper `<div>`. Do NOT use the prop-passing approach
(passing `pseudocode_summary` into `FileCard` as a new prop), as that would
require modifying `FileCard` which is not in scope for this step. The annotation
`<div>` sits below the file header but above the diff hunks, uses a subtle
background (e.g., `var(--bg-hover)`), and shows an `Info` icon (Lucide) + the
plain-text summary. Render as plain text only (no HTML interpretation).

When `pseudocode_summary` is null (current default), render nothing -- behavior
is identical to today.

Update `SmartDiffViewer.test.tsx`:
- Add a test case where one file has `pseudocode_summary: "Adds rate limiting to auth endpoint"` and verify the annotation text is rendered.
- Existing tests with `pseudocode_summary: null` should continue to pass with no annotation rendered.

**Skills:** `react-best-practices`, `react-testing-library`, `typescript-expert`
**Tests:** Updated `SmartDiffViewer.test.tsx`.
**Depends on:** none (independent; can be done in parallel with server work)
**Addresses:** AC-E11

---

### Step 11: Wire pseudocode_summary population into the smart-diff route

**Package:** server
**Files:**
- `server/src/modules/pulls/service.ts` (modify -- the `getSmartDiff` method)

**What:** The call site for `buildSmartDiff` is `PullsService.getSmartDiff()`
at `server/src/modules/pulls/service.ts:433`. This method currently selects
`path`, `additions`, `deletions` from `pr_files` but does NOT select `patch`.

To wire in `enrichSmartDiffSummaries`:
1. **Add `patch` to the select query:** Change the `pr_files` select at line 396
   to also include `t.prFiles.patch`. This provides the raw diff text per file
   needed by the enrichment function.
2. **Build a patches map:** After `buildSmartDiff` returns, build a
   `Map<string, string>` from `file.path -> file.patch` (skipping files where
   `patch` is null).
3. **Call `enrichSmartDiffSummaries`:** After `buildSmartDiff` returns, call
   `enrichSmartDiffSummaries(smartDiff, patchesMap, this.container, workspaceId)`.
   The `Container` is available as `this.container`. The `workspaceId` is
   already a parameter of `getSmartDiff`.
4. **Best-effort:** Wrap the enrichment call in a try-catch. If the LLM call
   fails, log a warning and return the SmartDiff with all summaries as null
   (graceful degradation). The `getSmartDiff` method signature and return type
   do not change.

The `patch` column is confirmed to exist in the `pr_files` table at
`server/src/db/schema/pulls.ts:44`. It is a nullable `text` column populated
during PR import (see `server/src/modules/pulls/service.ts:282,332`).

**Skills:** `fastify-best-practices`, `typescript-expert`
**Tests:** Covered by integration tests or existing smart-diff route tests.
**Depends on:** Step 9
**Addresses:** AC-OF1

---

## Parallel Execution Plan

The steps can be distributed across two agents:

**Agent 1 (Server):** Steps 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 9 -> 11
**Agent 2 (Client):** Steps 1 (copy contract) -> 7 -> 8 -> 10

Step 1 must complete first (shared contract). After that, server and client work
proceeds in parallel. Step 1 is performed by Agent 1; Agent 2 waits for the
contract file to exist, then copies it to the client package.

Within client work, Steps 7 and 8 are sequential (8 depends on 7). Step 10 is
independent and can be done in parallel with 7+8.

Within server work, Steps 2->3->4->5 are sequential. Step 6 is independent (just
a file). Steps 9->11 are sequential but independent of 4->5.

## Proactive Skills That Will Fire

- `engineering-insight` -- WILL fire. Plan modifies 3+ files across multiple
  packages. Must be invoked after implementation.
- `breaking-change` -- will NOT fire. No existing routes or contracts are
  modified; only new routes and a new contract file are added.
- `response-schema` -- will NOT fire. No existing API response shapes change.
- `deprecation-policy` -- will NOT fire. No public APIs are removed.
- `semver-discipline` -- will NOT fire. New additive feature, no breaking changes.

## Risk Assessment

1. **LLM output quality for risk assessment** -- The LLM may produce shallow or
   inaccurate risk assessments for unfamiliar codebases.
   *Mitigation:* The brief is explicitly AI-generated and supplements (not replaces)
   the mechanical findings. The prompt instructs conservative risk assessment.

2. **File path validation edge cases** -- LLM may return paths with
   different casing or path separators than the PR file list.
   *Mitigation:* Normalize paths before filtering: strip leading `./`, normalize
   separators to `/`, and compare case-insensitively. Log stripped paths (including
   both original and normalized forms) so false positives are debuggable. (GAP-11)

3. **LLM call latency** -- The brief generation LLM call adds a long-running
   request. Users may navigate away before completion.
   *Mitigation:* 60s LLM timeout + 65s socket timeout (onboarding pattern). Client
   mutation handles errors gracefully. Brief is cached so the result is available
   on return. Client GET hook polls every 3s while `{ status: 'generating' }` is
   returned, bridging the navigate-away-and-return case (EC-10). (GAP-2)

4. **Smart-diff summary LLM call cost** -- Adding an LLM call to the
   smart-diff classifier introduces latency and cost for every smart-diff request.
   *Mitigation:* The enrichment is best-effort. If cost is a concern, it can be
   gated behind a feature flag or setting. The summary LLM call uses a single
   batched request for all files, not per-file calls.

5. **Concurrent generation race (in-memory lock)** -- The in-memory lock is lost
   on server restart. A generation in progress at restart time will leave no
   brief in the DB.
   *Mitigation:* Acceptable for v1 (same as onboarding). Client's GET returns 404
   and user can retry. TTL safety net prevents permanent lock.

6. **vendor/shared copy drift** -- The contract file must be manually copied
   from server to client.
   *Mitigation:* Step 1 explicitly includes both copies. INSIGHTS.md documents
   this requirement. CI typecheck catches missing exports.

7. **Zero-files PR edge case** -- A PR with zero files imported (data anomaly
   or empty PR) could cause the LLM call to fail or produce meaningless output.
   *Mitigation:* Server returns 422 early before any LLM call. Client shows the
   error message in a toast and remains in its prior state. (GAP-1/EC-7)

8. **Patch data availability for smart-diff enrichment** -- The `patch` column
   in `pr_files` is nullable. Some files may have been imported without patch data.
   *Mitigation:* `enrichSmartDiffSummaries` skips files with null patches. Files
   without patches simply keep `pseudocode_summary: null`. (GAP-10)

## Out of Scope

- **Auto-generating briefs** -- spec non-goal. No auto-trigger on page load, PR
  open, or push events.
- **Auto-regenerating on push** -- spec non-goal. Stale badge + manual regenerate
  only.
- **Modifying existing contracts** -- spec non-goal. `RiskSeverity` in `brief.ts`
  is not touched; new `BriefRiskLevel` in new file.
- **Modifying existing `pr_brief` table** -- spec non-goal. New `pr_risk_brief`
  table only.
- **LLM-generated findings** -- spec non-goal. Summary row is mechanically
  computed.
- **Replacing IntentCard or BlastCard** -- spec non-goal. PrBriefCard is additive.
