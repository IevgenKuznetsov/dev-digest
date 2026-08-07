# Intent Layer — Implementation Plan

## Context

DevDigest reviews PRs but doesn't yet understand *why* a PR exists. The Intent Layer
classifies PR motivation from metadata (title, body, linked tickets, plans/specs, hunk
headers) using a **separate cheap flash-class model via OpenRouter**, then:
1. Shows the intent card on the PR Overview tab so users can verify understanding
2. Injects structured intent into the review prompt so reviewers are scope-aware
3. Filters out-of-scope findings (but keeps critical ones as a signal)

The user wants the classifier to receive **no full diff bodies** — only file list + hunk
headers. If PR description is empty, classify from indirect signals and mark lower
confidence. If there are links to plans/specs — fetch and use them. Unavailable links
must be explicitly flagged, never fabricated.

---

## 1. Data Sources

| Signal | Source | Available | Notes |
|--------|--------|-----------|-------|
| PR title | `pullRequests.title` (DB) | Always | Primary signal |
| PR body | `pullRequests.body` (DB) | Usually (nullable) | Truncated to 4000 chars |
| Branch name | `pullRequests.branch` (DB) | Always | `feat/`, `fix/` prefixes |
| Commit messages | `prCommits` table | Always (1+) | Cap at 20 |
| File paths | `prFiles` table | Always | Cap at 100 |
| Hunk headers | `UnifiedDiff.files[].hunks` | After diff load | Function/class names after `@@` — **currently not captured**, parser must be extended |
| Linked issue | GitHub adapter `resolveLinkedIssue()` | Sometimes | **Not stored in DB** — must re-resolve via Octokit during classification |
| Plan/spec files | Links in PR body (`docs/*.md`, repo-internal paths) | Sometimes | Read from clone dir, cap at 3, truncate to 2000 chars each |

**Key gap:** Linked issues are fetched live by the GitHub adapter but never persisted.
During review runs we only have `PullRow` (no linked issue field). Options:
- **(A) Re-fetch from GitHub** during intent classification (adds 1 API call)
- **(B) Store linked issue in DB** as a new column on `pullRequests` or separate table

**Recommendation:** (A) for simplicity. The GitHub adapter already has `resolveLinkedIssue()`.
Pass the `GitHubClient` to the intent service and call it during signal gathering.

---

## 2. Execution Order

```
POST /pulls/:id/review  (or POST /pulls/:id/intent for standalone)
        │
        ▼
┌─ Pre-work (shared, once per run) ────────────────────┐
│  1. Load PR diff (existing — run-executor.ts:95-104)  │
│  2. [NEW] Classify intent:                            │
│     a. Gather signals (title, body, branch, commits,  │
│        files, hunk headers from diff)                 │
│     b. Re-fetch linked issue via GitHub adapter       │
│     c. Extract plan/spec links from body, read files  │
│     d. Compute confidence MECHANICALLY                │
│     e. Resolve flash model via feature_models setting │
│     f. Build prompt (reviewer-core/src/intent.ts)     │
│     g. Call LLM → structured JSON                     │
│     h. Override confidence with mechanical value      │
│     i. Persist via upsertIntent()                     │
│     j. Log: sources, model, tokens, confidence        │
└───────────────────────────────────────────────────────┘
        │
        ▼
┌─ Per-agent review loop (existing, modified) ──────────┐
│  For each agent:                                      │
│    1. Resolve LLM, build repo-intel context (existing)│
│    2. [MODIFIED] Inject intent into PromptParts       │
│    3. reviewPullRequest() (existing engine)            │
│    4. [NEW] Scope-filter findings post-grounding      │
│    5. Persist review + findings (existing)            │
└───────────────────────────────────────────────────────┘
```

Two separate LLM calls are visible in logs:
1. **Intent classification** — cheap flash model (pre-work)
2. **Review** — capable model (per-agent, existing)

---

## 3. Schema Changes

### 3a. DB: extend `prIntent` table

**File:** `server/src/db/schema/reviews.ts:48-55`

Add columns to the existing `prIntent` table:

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| `confidence` | `text` | `'low'` | no |
| `riskAreas` | `jsonb (string[])` | `'[]'::jsonb` | no |
| `intentType` | `text` | — | yes |
| `model` | `text` | — | yes |
| `sources` | `jsonb` | `'{}'::jsonb` | no |
| `createdAt` | `timestamptz` | `now()` | no |

The `sources` column stores metadata about what was available:
```json
{
  "has_body": true,
  "has_linked_issue": true,
  "plan_links_found": 2,
  "plan_links_used": 1,
  "plan_links_failed": ["docs/spec-v2.md"],
  "commit_count": 5,
  "file_count": 12
}
```

**Migration:** `cd server && pnpm db:generate && pnpm db:migrate`
All new columns have defaults or are nullable → safe on existing rows.

### 3b. Contract: new `intent.ts` in vendor/shared

**File:** `server/src/vendor/shared/contracts/intent.ts` (CREATE)

Never edit `brief.ts`. Create a new file:

```typescript
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export const IntentType = z.enum([
  'feature', 'bug_fix', 'refactor', 'chore',
  'security_patch', 'performance', 'test'
]);

// What the LLM returns (json_schema target)
export const IntentClassification = z.object({
  summary: z.string(),           // user wants "summary" field name
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  risk_areas: z.array(z.string()),
  intent_type: IntentType,
});

// Sources metadata (mechanical, not from LLM)
export const IntentSources = z.object({ ... });

// Full persisted record
export const EnrichedIntent = IntentClassification.extend({
  confidence: IntentConfidence,
  model: z.string().nullish(),
  sources: IntentSources.nullish(),
  created_at: z.string().nullish(),
});
```

**Note on field naming:** The user spec says `Intent { summary, in_scope[], out_of_scope[] }`.
The existing `Intent` contract in `brief.ts` uses `intent` (not `summary`). The new
`IntentClassification` schema uses `summary`. The DB column stays `intent` (text) — the
mapping happens in the repository layer (`summary` ↔ `intent` column).

### 3c. Hunk header extraction

**File:** `server/src/adapters/git/diff-parser.ts:46`

Extend the regex to capture the text after `@@`:
```typescript
// Before:
const hh = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
// After:
const hh = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\s*(.*?)$/);
// hh[5] = header text (e.g., "function rateLimit()")
```

**File:** `server/src/vendor/shared/adapters.ts` — **CANNOT edit** (vendor rule).

Instead, store the header text on a parallel structure or in the intent service only.
The `DiffHunk` interface can't be extended (vendor/shared). Two options:
- **(A)** Create a helper `extractHunkHeaders(diff: UnifiedDiff, raw: string)` that
  re-parses `diff.raw` to extract only the `@@ ... @@ functionName` lines.
  No schema change needed.
- **(B)** Add a new interface `DiffHunkWithHeader extends DiffHunk` in the new contract
  file. But `parseUnifiedDiff` returns `UnifiedDiff` which uses `DiffHunk[]`.

**Recommendation:** (A) — a standalone helper in the intent service that extracts
`Map<filePath, string[]>` of hunk header texts from `diff.raw`. Minimal change,
no vendor/shared modification.

---

## 4. API Changes

### 4a. GET /pulls/:id/intent — read stored intent

**File:** `server/src/modules/reviews/routes.ts`

```typescript
app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  const intent = await service.getIntent(workspaceId, req.params.id);
  if (!intent) throw new NotFoundError('Intent not classified yet');
  return intent;
});
```

Returns `EnrichedIntent` (200) or 404.

### 4b. POST /pulls/:id/intent — re-classify intent on demand

**File:** `server/src/modules/reviews/routes.ts`

```typescript
app.post('/pulls/:id/intent', {
  schema: { params: IdParams },
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
}, async (req) => {
  const { workspaceId } = await getContext(container, req);
  return service.classifyIntent(workspaceId, req.params.id, req.log);
});
```

This allows users to re-classify after PR update, independent of running a full review.
Rate-limited (cheap model call but still costs tokens).

---

## 5. Prompt Builder (reviewer-core)

### 5a. Intent classification prompt

**File:** `reviewer-core/src/intent.ts` (CREATE)

```typescript
import { wrapUntrusted } from './prompt.js';
// Import INJECTION_GUARD indirectly — assemblePrompt appends it,
// but for intent we build messages directly, so import + append manually.

export interface IntentSignals {
  title: string;
  body?: string;
  branch: string;
  commitMessages: string[];    // cap 20
  filePaths: string[];         // cap 100
  hunkHeaders: string[];       // extracted "function foo()" texts
  linkedIssue?: { title: string; body?: string };
  planExcerpts?: { path: string; text: string }[];  // cap 3, 2000 chars each
  unavailableLinks?: string[]; // links that couldn't be fetched
}

export function buildIntentPrompt(signals: IntentSignals): ChatMessage[] { ... }
export function computeConfidence(signals: IntentSignals): 'high' | 'medium' | 'low' { ... }
```

The system prompt instructs the model to classify, NOT to invent missing context.
If `unavailableLinks` is non-empty, the prompt explicitly tells the model:
"The following links were referenced but could not be fetched: [...]. Do NOT fabricate
their content. Mark the gap in your classification."

**No full diff bodies** — only `filePaths` and `hunkHeaders` are passed.

### 5b. Intent injection into review prompt

**File:** `reviewer-core/src/prompt.ts` (MODIFY)

Add optional `prIntent` field to `PromptParts`:
```typescript
/** Structured intent (untrusted — derived from PR metadata by a separate LLM call). */
prIntent?: string;
```

Render as a new section between `## PR description` and `## Skills / rules`:
```typescript
if (parts.prIntent) {
  userSections.push(`## PR intent\n${wrapUntrusted('pr-intent', parts.prIntent)}`);
}
```

Also add to `PromptAssembly`:
```typescript
pr_intent: parts.prIntent ?? null,
```

### 5c. ReviewInput extension

**File:** `reviewer-core/src/review/run.ts` (MODIFY)

Add to `ReviewInput`:
```typescript
/** Structured intent JSON, injected as a prompt section (untrusted). */
prIntent?: string;
```

Pass through to `assemblePrompt()` in `promptParts`.

---

## 6. Intent Service

**File:** `server/src/modules/reviews/intent-service.ts` (CREATE)

Orchestrates the full pipeline:

```typescript
export async function classifyIntent(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  repoRow: RepoRow,
  diff: UnifiedDiff,
  runLog: RunLogger,
): Promise<EnrichedIntent> {
  // 1. Gather signals
  const commits = await repo.getPrCommits(pull.id);  // need to add this method
  const files = await repo.getPrFiles(pull.id);
  const hunkHeaders = extractHunkHeaders(diff.raw);
  
  // 2. Resolve linked issue (re-fetch from GitHub)
  const github = await container.github();
  const linkedIssue = pull.body
    ? await github.resolveLinkedIssue({ owner: repoRow.owner, name: repoRow.name }, pull.body)
    : undefined;
  
  // 3. Extract and fetch plan/spec links from body
  const planExcerpts = await fetchPlanExcerpts(container, repoRow, pull.body);
  
  // 4. Compute confidence mechanically
  const signals: IntentSignals = { ... };
  const confidence = computeConfidence(signals);
  
  // 5. Resolve flash model
  const { provider, model } = await resolveFeatureModel(container, workspaceId, 'review_intent');
  const llm = await container.llm(provider);
  
  // 6. Build prompt + call LLM
  const messages = buildIntentPrompt(signals);
  const result = await llm.completeStructured({
    model, schema: IntentClassification, schemaName: 'intent',
    messages, temperature: 0.2, maxTokens: 1024,
  });
  
  // 7. Merge with mechanical confidence
  const enriched = { ...result.data, confidence, model, sources: { ... } };
  
  // 8. Persist
  await repo.upsertIntent(pull.id, enriched);
  
  // 9. Log
  runLog.event('info', 'Intent classified', {
    confidence, model, intent_type: result.data.intent_type,
    tokens_in: result.tokensIn, tokens_out: result.tokensOut,
    sources: { ... },
  });
  
  return enriched;
}
```

### Plan/spec link extraction

```typescript
async function fetchPlanExcerpts(container, repo, body): Promise<PlanExcerpt[]> {
  if (!body) return [];
  // Regex: match repo-internal file references (docs/*.md, specs/*.md, *.spec.md)
  const linkRegex = /(?:docs|specs|plans?)\/[\w\-\/]+\.md/gi;
  const matches = [...body.matchAll(linkRegex)].slice(0, 3); // cap at 3
  
  const excerpts = [];
  for (const match of matches) {
    const filePath = path.join(container.config.cloneDir, repo.owner, repo.name, match[0]);
    try {
      const text = await fs.readFile(filePath, 'utf-8');
      excerpts.push({ path: match[0], text: text.slice(0, 2000) });
    } catch {
      // File not found — record as unavailable, DO NOT fabricate
      signals.unavailableLinks.push(match[0]);
    }
  }
  return excerpts;
}
```

### Error handling

If the LLM call fails, log the error but **do not fail the review run**.
Intent is best-effort enrichment — same pattern as `buildCallersDigest` in run-executor.

---

## 7. Scope Filtering (post-grounding)

**File:** `reviewer-core/src/intent.ts` (or new `scope-filter.ts`)

After the existing `groundFindings()` gate, apply a scope filter:

```typescript
export function filterByScope(
  findings: Finding[],
  intent: { in_scope: string[]; out_of_scope: string[] },
): { kept: Finding[]; demoted: Finding[] } {
  // All CRITICAL and WARNING findings are ALWAYS kept
  // SUGGESTION/INFO findings that touch files clearly outside scope → demoted
  // "Demoted" = not removed, but marked with a flag for UI to show differently
}
```

**Rules:**
1. CRITICAL findings are **never filtered** regardless of scope
2. WARNING findings **stay** but get an `out_of_scope: true` annotation
3. SUGGESTION findings outside scope → demoted (one signal kept per unique area)
4. "Outside scope" is determined by matching finding rationale/file against
   `out_of_scope` items (fuzzy text match, not exact)

This is NOT a modification to `groundFindings()` (which is do-not-touch).
It's a separate post-processing step called by the run executor after grounding.

---

## 8. Run Executor Integration

**File:** `server/src/modules/reviews/run-executor.ts` (MODIFY)

### Pre-work: add intent classification after diff loading (line 104)

```typescript
// After diff loading, before agent loop:
let intent: EnrichedIntent | undefined;
try {
  intent = await runLog.step(
    'Classifying PR intent',
    () => classifyIntent(this.container, this.repo, workspaceId, pull, repo, diff, runLog),
    { kind: 'tool' },
  );
} catch (err) {
  runLog.info(`Intent classification failed — continuing without intent: ${(err as Error).message}`);
}
```

### Per-agent: inject intent into reviewPullRequest call (line 199)

```typescript
const outcome = await reviewPullRequest({
  // ... existing params ...
  // NEW: inject structured intent as a prompt section
  ...(intent ? { prIntent: JSON.stringify(intent) } : {}),
});
```

### Per-agent: scope-filter after grounding

```typescript
// After reviewPullRequest returns, before persist:
if (intent) {
  const { kept, demoted } = filterByScope(outcome.review.findings, intent);
  // Log demoted findings
  // Annotate kept findings that are out-of-scope
}
```

---

## 9. UI Components

### 9a. IntentCard component

**File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/IntentCard/IntentCard.tsx` (CREATE)

Matches the design in `docs/IntentLayer/design1.png`:

```
┌─ ⚡ INTENT ──────────────────── [Medium confidence] ─┐
│                                                       │
│  "Add rate limiting to public API endpoints to        │
│   prevent abuse from unauthenticated clients."        │
│                                                       │
│  ✓ IN SCOPE              ✗ OUT OF SCOPE               │
│  · Add middleware...      · Authentication changes     │
│  · Apply to /api/public   · Adding new endpoints       │
│  · Return 429 with...     · Logging / observability    │
│                                                       │
│  ⚠ RISK AREAS                                         │
│  ● Auth surface touched  ● New dependency: ioredis     │
│  ✦ Adds Redis round-trip per request                   │
└────────────────────────────────────────────────────────┘
```

- Confidence badge shown when not "high"
- "Low confidence — inferred from title and diff" tooltip
- Sources metadata shown in collapsed details (how many signals used)
- Risk area badges are truncated with ellipsis (max 260px) and wrapped in a `<Tooltip>`
  that shows the full risk area message on hover (320px wide, center-aligned)

### 9b. usePrIntent hook

**File:** `client/src/lib/hooks/reviews.ts` (MODIFY)

```typescript
export function usePrIntent(prId: string | undefined) {
  return useQuery({
    queryKey: ['pr-intent', prId],
    queryFn: () => api.get<EnrichedIntent>(`/pulls/${prId}/intent`),
    enabled: !!prId,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
}
```

### 9c. Re-classify button

A button in the IntentCard header: "Re-classify". Calls `POST /pulls/:id/intent`,
invalidates the query cache, shows loading state. Useful when PR was updated.

### 9d. Integration into OverviewTab

**File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` (MODIFY)

Render `<IntentCard>` between PR Brief and Blast Radius sections.
Show skeleton while loading. If 404 (no intent yet), show nothing (not an error).

---

## 10. Logging / Observability

Two separate LLM calls are logged per review run:

### Intent classification log entry:
```json
{
  "kind": "info",
  "msg": "Intent classified",
  "data": {
    "model": "google/gemini-2.0-flash",
    "confidence": "medium",
    "intent_type": "feature",
    "tokens_in": 840,
    "tokens_out": 210,
    "duration_ms": 1200,
    "sources": {
      "has_body": true,
      "has_linked_issue": false,
      "plan_links_found": 1,
      "plan_links_used": 1,
      "plan_links_failed": [],
      "commit_count": 3,
      "file_count": 8,
      "hunk_headers_count": 12
    }
  }
}
```

### What is NOT logged:
- No secrets (API keys, tokens)
- No full diff bodies
- No full PR body text
- No plan/spec content (only paths and counts)
- No raw LLM prompt or response (those go into `run_traces.prompt_assembly`)

### Trace integration:
Intent classification metadata is captured in `PromptAssembly.pr_intent` so the
RunTrace drawer can show "Intent prompt section" alongside callers/repoMap/specs.

---

## 11. Feature Model Default

**Issue:** The `review_intent` feature model in `platform.ts:52-57` defaults to
`openai` / `gpt-4.1` — not a flash-class model. The user wants a cheap OpenRouter
model by default.

**Constraint:** Cannot edit existing contracts in `vendor/shared/`.

**Resolution options:**
- **(A)** Update the default in `platform.ts` — this is configuration data, not a
  contract shape change. The Zod schema/types are unchanged. Defensible.
- **(B)** Override at the service layer — if no workspace setting exists, hardcode
  the cheap model in `intent-service.ts` instead of using `resolveFeatureModel`.
- **(C)** Leave the default as-is. Users pick their flash model in Settings.

**Recommendation:** (A) — change `defaultProvider: 'openrouter'` and
`defaultModel: 'google/gemini-2.0-flash'` (or similar flash model). This is the
cleanest path and the registry exists exactly for this purpose. If we consider this
a vendor/shared violation, fall back to (B).

---

## 12. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Prompt injection via PR title/body/issue | Medium | `wrapUntrusted()` + `INJECTION_GUARD` on every prompt |
| LLM latency in pre-work | Low | Flash model (1-2s), once not per-agent, fails gracefully |
| Migration on existing prIntent rows | Low | All new columns have defaults or nullable |
| Linked issue re-fetch adds GitHub API call | Low | 1 call per classification; rate-limited upstream |
| Scope filter drops valid findings | Medium | CRITICAL never filtered; WARNING annotated not removed |
| Fabricated context from unavailable links | Medium | Explicit `unavailableLinks` in prompt; model instructed not to invent |
| Hunk header regex change breaks diff parser | Low | Additive regex group; existing captures unchanged |

---

## 13. Implementation Order

| # | Step | Package | Key Files | Depends |
|---|------|---------|-----------|---------|
| 1 | Extend `prIntent` table + migration | server | `db/schema/reviews.ts` | — |
| 2 | Create `IntentClassification` contract | server | `vendor/shared/contracts/intent.ts` (new) | — |
| 3 | Hunk header extraction helper | server | `modules/reviews/hunk-headers.ts` (new) | — |
| 4 | Build intent prompt + confidence | reviewer-core | `src/intent.ts` (new) | 2 |
| 5 | Update repository methods for enriched intent | server | `reviews/repository/pull.repo.ts` | 1, 2 |
| 6 | Add `prCommits` query to repository | server | `reviews/repository/pull.repo.ts` | — |
| 7 | Implement IntentService | server | `reviews/intent-service.ts` (new) | 2-6 |
| 8 | Inject `prIntent` into PromptParts + ReviewInput | reviewer-core | `prompt.ts`, `review/run.ts` | — |
| 9 | Scope-filter post-grounding | reviewer-core | `src/scope-filter.ts` (new) | 2 |
| 10 | Integrate into RunExecutor | server | `reviews/run-executor.ts` | 7, 8, 9 |
| 11 | API routes (GET + POST /pulls/:id/intent) | server | `reviews/routes.ts` | 5, 7 |
| 12 | Update feature model default | server | `vendor/shared/contracts/platform.ts` | — |
| 13 | Client hook `usePrIntent` | client | `lib/hooks/reviews.ts` | 11 |
| 14 | IntentCard component | client | `OverviewTab/IntentCard/` (new) | 2 |
| 15 | Wire IntentCard into OverviewTab | client | `OverviewTab.tsx` | 13, 14 |

---

## 14. Verification Checklist

After implementation, verify:

- [ ] Intent card correctly describes PR purpose on the Overview tab
- [ ] Classifier runs on a separate cheap model (visible in logs as a distinct LLM call)
- [ ] Classifier prompt contains NO full diff bodies (only file paths + hunk headers)
- [ ] Plan/spec links from PR body are fetched and included in classification
- [ ] Unavailable links are explicitly flagged, not fabricated
- [ ] `architecture-reviewer` and `plan-verifier` agents cannot modify files (read-only)
- [ ] Log shows prompt composition: sources, model, tokens — no secrets, no diff bodies
- [ ] Two distinct LLM calls visible in run log: intent (cheap) + review (capable)
- [ ] CRITICAL findings outside scope are never filtered
- [ ] Re-classify button works after PR update
- [ ] Empty PR body → low confidence, still classifies from title + files + commits
