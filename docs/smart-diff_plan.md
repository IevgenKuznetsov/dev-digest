# Implementation Plan: Smart Diff

**Scope:** server (pulls module), client (DiffTab + new hook)
**Estimated complexity:** medium
**Created:** 2026-08-07

## Context

Smart Diff sorts PR files by risk so reviewers see business-logic first, not lock-files or generated code. It deterministically classifies each PR file into one of three roles: **core** (business logic), **wiring** (config, index files), **boilerplate** (lock files, dist, snapshots). No LLM calls -- purely path/pattern-based classification. It combines file data already persisted in `pr_files` with findings from the latest review (the `findings` table).

The Zod contracts (`SmartDiff`, `SmartDiffGroup`, `SmartDiffFile`, `SmartDiffRole`, `ProposedSplit`) already exist in `server/src/vendor/shared/contracts/brief.ts` lines 80-113 and are already copied to the client at `client/src/vendor/shared/contracts/brief.ts`. The client already re-exports `SmartDiff` from `client/src/lib/types.ts`.

No new DB tables are needed -- the feature reads from existing `pr_files` and `findings`/`reviews` tables.

## Architecture Constraints

- **vendor/shared/ is extend-only** -- The SmartDiff Zod contracts already exist in `brief.ts`; we must NOT edit them. Source: root `CLAUDE.md`, `server/CLAUDE.md`.
- **Modules are registered statically** in `server/src/modules/index.ts` -- Since Smart Diff is added to the existing `pulls` module, no registration change is needed. Source: root `CLAUDE.md`.
- **Routes delegate to Service, not Repository directly** -- Established onion pattern: Routes -> Service -> Repository. Source: `server/INSIGHTS.md`.
- **Drizzle select() infers DB columns as `string`, not Zod literal unions** -- Cast fields like `severity as Severity` when mapping to contract types. Source: `server/INSIGHTS.md`.
- **Migrations are NOT applied on boot** -- No migrations needed for this feature. Source: root `CLAUDE.md`.
- **Client `vendor/shared/` is a physical copy, not a symlink** -- The SmartDiff contract is already present in both copies. Source: `client/INSIGHTS.md`.
- **TanStack Query caches 404 errors** -- Smart Diff route must NOT return 404 when no review exists; it returns the classification without findings instead (empty `finding_lines`). Source: `client/INSIGHTS.md`.

## Pre-implementation Checklist

- [ ] Migration needed? **No** -- reads from existing `pr_files` and `findings` tables.
- [ ] New module needed? **No** -- extends the existing `pulls` module.
- [ ] New shared contracts needed? **No** -- `SmartDiff`, `SmartDiffGroup`, `SmartDiffFile`, `SmartDiffRole`, `ProposedSplit` already exist in `vendor/shared/contracts/brief.ts`.
- [ ] New adapter needed? **No** -- pure computation on existing DB data.

## Steps

### Step 1: Create the file classifier engine

**Package:** server
**Files:** `server/src/modules/pulls/classifier.ts` (create)
**What:** Create a deterministic file classifier that maps a file path to a `SmartDiffRole`. This is a pure domain-logic module with zero external dependencies (no DB, no Fastify, no adapters).

The classifier should:
1. Export a `classifyFile(path: string): SmartDiffRole` function.
2. Export all pattern constants (arrays of globs/regexps) in a dedicated `PATTERNS` object for testability and future tuning.
3. Classification logic:
   - **boilerplate** -- matches if any pattern hits: lock files (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Gemfile.lock`, `Cargo.lock`, `composer.lock`, `poetry.lock`, `go.sum`), `dist/`, `build/`, `.next/`, `node_modules/`, `.min.js`/`.min.css`, `.snap` files, `vendor/` paths, generated code markers (`.generated.`, `.g.ts`, `.g.dart`, `__generated__/`, `.pb.go`, `_pb2.py`), coverage reports (`coverage/`, `lcov.info`), source maps (`.map`).
   - **wiring** -- matches if any pattern hits: config files (`*.config.ts`, `*.config.js`, `*.config.mjs`, `tsconfig*.json`, `.eslintrc*`, `.prettierrc*`, `biome.json`, `jest.config.*`, `vitest.config.*`, `.env*`, `Dockerfile*`, `docker-compose*`), CI/CD (`.github/`, `.gitlab-ci*`, `.circleci/`, `Jenkinsfile`), index barrel re-exports (`index.ts`, `index.js`, `index.tsx`, `index.jsx` -- ONLY files named literally `index.*`), migration files (`migrations/`, `drizzle/`), package manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, `pom.xml`, `build.gradle`).
   - **core** -- everything that does not match boilerplate or wiring (default).
4. Export a `TOO_BIG_THRESHOLD` constant (e.g., 500 total changed lines) used for `split_suggestion.too_big`.
5. Export a `buildSmartDiff(files, findingsByFile)` function that takes classified file data and returns a `SmartDiff` object conforming to the contract:
   - Groups files by role, orders groups `core -> wiring -> boilerplate`.
   - Within each group, sorts files by finding count descending (files with more findings first), then by `additions + deletions` descending as tiebreaker.
   - Computes `split_suggestion`: `too_big = total_lines > TOO_BIG_THRESHOLD`; `total_lines = sum(additions + deletions)` across all files; `proposed_splits` returns `[]` (no LLM, so no meaningful split proposals for now).
   - Each `SmartDiffFile` has `finding_lines` populated from the findings map, and `pseudocode_summary` set to `null`.

**Skills:** `typescript-expert`
**Tests:** `server/src/modules/pulls/classifier.test.ts` (create) -- unit tests covering:
  - Each role classification (core, wiring, boilerplate) with representative paths.
  - Edge cases: `src/index.ts` (wiring), `src/components/Button/index.ts` (wiring), `src/services/auth.ts` (core), `dist/bundle.js` (boilerplate).
  - `buildSmartDiff` with mixed files and findings, verifying group ordering and file sorting.
  - `too_big` threshold logic.
**Depends on:** none

### Step 2: Add `getSmartDiff` method to PullsService

**Package:** server
**Files:** `server/src/modules/pulls/service.ts` (modify)
**What:** Add a `getSmartDiff(workspaceId: string, prId: string): Promise<SmartDiff>` method that:
1. Calls `resolvePrAndRepo(prId, workspaceId)` to validate ownership (reuse existing private helper at line 390).
2. Fetches PR files from `pr_files` table: `SELECT path, additions, deletions FROM pr_files WHERE pr_id = ?`.
3. Fetches findings from the **latest** review (if any):
   - Join `findings` to `reviews` where `reviews.pr_id = prId AND reviews.kind = 'review'`.
   - Order `reviews` by `created_at DESC`, take only findings from the most recent review.
   - Select `file` and `start_line` from `findings`.
   - Group findings by file path into a `Map<string, number[]>` (file -> array of start_line values).
4. If no PR files exist in the DB, throw `NotFoundError`.
5. Import and call `buildSmartDiff(classifiedFiles, findingsByFile)` from `classifier.ts`.
6. Return the `SmartDiff` typed result.

The method must handle the case where no review exists yet gracefully -- `findingsByFile` is simply an empty map, and `finding_lines` arrays are empty.

**Skills:** `drizzle-orm-patterns`, `typescript-expert`
**Tests:** Part of the integration test in Step 3.
**Depends on:** Step 1

### Step 3: Add GET /pulls/:id/smart-diff route

**Package:** server
**Files:** `server/src/modules/pulls/routes.ts` (modify)
**What:** Add a new route handler to the existing `pullsRoutes` plugin after the existing `GET /pulls/:id` route:

```
app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req): Promise<SmartDiff> => {
  const { workspaceId } = await getContext(app.container, req);
  return service.getSmartDiff(workspaceId, req.params.id);
});
```

Import `SmartDiff` from `@devdigest/shared` at the top of the file.

**Skills:** `fastify-best-practices`, `typescript-expert`
**Tests:** `server/src/modules/pulls/smart-diff.it.test.ts` (create) -- integration test:
  - Seed a workspace, repo, PR, and PR files.
  - Call `GET /pulls/:id/smart-diff` via `app.inject()`.
  - Assert response has `groups` array with `core`, `wiring`, and/or `boilerplate` entries.
  - Assert files are correctly classified (e.g., `package-lock.json` in boilerplate, `src/app.ts` in core).
  - Seed a review with findings, re-call, assert `finding_lines` are populated.
  - Assert `split_suggestion.total_lines` matches sum of additions + deletions.
**Depends on:** Step 2

### Step 4: Create `useSmartDiff` TanStack Query hook

**Package:** client
**Files:** `client/src/lib/hooks/reviews.ts` (modify)
**What:** Add a new hook:

```typescript
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
    staleTime: 30_000,
  });
}
```

Import `SmartDiff` from `@devdigest/shared`. Use `staleTime: 30_000` since classification changes only when PR files change or a new review is run.

**Skills:** `react-best-practices`, `typescript-expert`
**Tests:** No separate test -- tested through SmartDiffViewer component test.
**Depends on:** Step 3

### Step 5: Create SmartDiffViewer component

**Package:** client
**Files:**
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.tsx` (create)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/index.ts` (create)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/constants.ts` (create)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/styles.ts` (create)

**What:** Create the grouped file viewer as a sub-component of DiffTab.

`SmartDiffViewer.tsx`:
- Props: `{ groups: SmartDiffGroup[], files: PrFile[], commenting?: DiffCommentApi }`.
- Renders three collapsible sections in order: Core, Wiring, Boilerplate (skip empty groups).
- Each section header shows: role label (capitalized), file count badge, total finding count badge.
- **Boilerplate section is collapsed by default**; Core and Wiring are expanded.
- Finding count badges per file are clickable -- clicking scrolls to the corresponding `FileCard` using `scrollIntoView({ behavior: 'smooth', block: 'start' })` via refs.
- Each file renders the existing `FileCard` component from `@/components/diff-viewer`. Maps `SmartDiffFile` (no `patch`) back to full `PrFile` (has `patch`) by joining on `path`.
- Uses `SectionLabel` from `@devdigest/ui` for each group heading.
- Uses `Badge` from `@devdigest/ui` for finding count badges.

`constants.ts`:
- `ROLE_ORDER`, `ROLE_LABELS`, `ROLE_ICONS`, `DEFAULT_COLLAPSED` maps.

`styles.ts`:
- CSSProperties objects with CSS variables following existing patterns.

**Skills:** `react-best-practices`, `react-frontend-best-practices`, `typescript-expert`
**Tests:** `SmartDiffViewer.test.tsx` (create) -- component test:
  - Renders three groups with correct headings.
  - Boilerplate section is collapsed by default.
  - Finding badges show correct counts.
  - Empty groups are not rendered.
**Depends on:** Step 4

### Step 6: Wire SmartDiffViewer into DiffTab with fallback

**Package:** client
**Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` (modify)
**What:** Modify the existing `DiffTab` to:
1. Call `useSmartDiff(prId)` to fetch smart-diff data.
2. When smart-diff data is loaded: render `<SmartDiffViewer>` instead of flat `<DiffViewer>`.
3. When loading or errored: render the existing flat `<DiffViewer>` (graceful fallback).
4. Add a toggle button in `SectionLabel` right slot: "Group by risk" / "Flat view" -- allows switching between grouped and flat views.

**Skills:** `react-best-practices`, `react-frontend-best-practices`, `typescript-expert`
**Tests:** Regression covered by SmartDiffViewer test from Step 5.
**Depends on:** Step 5

### Step 7: Invalidate smart-diff cache on review completion

**Package:** client
**Files:** `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (modify)
**What:** In the `onRunDone` callback (around line 158-163), add:

```typescript
if (prId) qc.invalidateQueries({ queryKey: ["smart-diff", prId] });
```

This ensures `finding_lines` update when a review finishes.

**Skills:** `react-best-practices`
**Tests:** No separate test -- covered by manual verification.
**Depends on:** Step 6

## Proactive Skills That Will Fire

- `engineering-insight` -- **will fire** because this feature modifies 5+ files across server and client.
- `breaking-change` -- **will not fire** because we are adding a new route, not modifying existing routes or contracts.
- `response-schema` -- **will not fire** because the response shape uses the pre-existing `SmartDiff` Zod contract.

## Risk Assessment

- **Risk: File classification accuracy** -- Some files may be mis-classified (e.g., `src/utils/index.ts` could be core or wiring). Mitigation: Default to `core` for anything not explicitly matched (safe default). Patterns are in a single `PATTERNS` object, easy to tune. Classifier is pure and unit-tested.

- **Risk: Large PRs with many files** -- 200+ files could slow rendering. Mitigation: Existing `FileCard` auto-collapses large diffs, boilerplate group is collapsed by default. Future optimization (virtualization) can be added if measured.

- **Risk: Joining SmartDiffFile to PrFile by path** -- If paths don't match, a file would be missing its patch. Mitigation: Both derive from the same `pr_files` table, so paths are guaranteed to match.

- **Risk: staleTime mismatch** -- smart-diff has `staleTime: 30_000` but `usePullDetail` defaults to 0. Mitigation: 30s staleness is acceptable for classification. Smart-diff is also invalidated on review completion.

## Out of Scope

- **LLM-based pseudocode summaries** -- `pseudocode_summary` is set to `null`. Separate feature.
- **Proposed splits** -- `proposed_splits` returns `[]`. Requires heuristics or LLM beyond deterministic classification.
- **PageRank-enhanced classification** -- repo-intel's `getFileRank()` could boost accuracy. Future enhancement.
- **Persistent caching** -- Classification is cheap (string matching), no need to persist results.
