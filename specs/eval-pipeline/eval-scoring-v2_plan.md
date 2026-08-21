# Implementation Plan: Eval Scoring V2 — Hunk Extraction & Metric Fixes

**Spec:** `specs/eval-pipeline/eval-scoring-v2.spec.md`
**Scope:** client, server
**Estimated complexity:** low
**Created:** 2026-08-21

## Context

Three issues exist in the eval system: (1) eval cases created from findings capture the entire file diff instead of just the relevant hunks, (2) recall returns `null` when there are no `must_find` expectations instead of `1.0`, and (3) precision ignores `must_not_flag` expectations entirely. This plan addresses all three.

## Requirements Summary

- **Change 1 (client):** Extract only overlapping hunk(s) when creating an eval case from a finding, instead of passing the full file patch.
- **Change 2 (server):** Return `recall = 1.0` (not `null`) when `totalMustFind === 0`.
- **Change 3 (server):** Rewrite precision formula to account for `must_not_flag` expectations: `(matched_must_find + satisfied_must_not_flag) / (total_must_find + total_must_not_flag + unmatched_findings)`.

## Spec Coverage Matrix

| Criterion | Plan Step(s) |
|-----------|-------------|
| Hunk extraction — single hunk finding overlap returns that hunk | Step 1, Step 2 |
| Hunk extraction — multi-hunk, finding overlaps one, returns only that one | Step 1, Step 2 |
| Hunk extraction — finding spans two hunks, returns both | Step 1, Step 2 |
| Hunk extraction — no hunk overlap, falls back to full patch | Step 1, Step 2 |
| Hunk extraction — preserves diff header | Step 1, Step 2 |
| Manual eval case creation unchanged | Step 2 (no changes to manual flow) |
| Recall returns 1.0 when no must_find expectations | Step 3, Step 4 |
| Precision with must_not_flag satisfied | Step 3, Step 4 |
| Precision with must_not_flag violated | Step 3, Step 4 |
| Precision with mixed must_find + must_not_flag + noise | Step 3, Step 4 |
| Precision 1.0 for empty case (0 expectations, 0 findings) | Step 3, Step 4 |
| Precision with only must_not_flag, all satisfied | Step 3, Step 4 |

## Architecture Constraints

- `vendor/shared/` is extend-only, never edit existing contracts. No contract changes needed.
- Integration tests use `*.it.test.ts` suffix. All changes here are unit-testable.
- No schema changes, no migrations, no new modules.

## Recommendations

1. **File location for diff helper:** Place at `client/src/lib/diff-utils.ts` (flat file in `lib/`) instead of `client/src/lib/utils/diff.ts` (new subdirectory), matching the established convention (`github-urls.ts`, `model-label.ts`).
2. **Precision never returns null under new formula:** The new division-by-zero guard always produces `1.0` instead of `null`. The `BatchMetrics.precision` type stays `number | null` for backward compatibility with persisted data, but the runtime function never returns `null` going forward.

---

## Steps

### Step 1: Create `extractRelevantHunks` helper

**Package:** client
**Create:** `client/src/lib/diff-utils.ts`, `client/src/lib/diff-utils.test.ts`

Create a pure function `extractRelevantHunks(patch: string, startLine: number, endLine: number): string`:

1. Split the patch into a header section (lines before the first `@@ ... @@`) and individual hunk sections.
2. Parse each hunk header with regex `/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/` to extract `newStart` and `newLines` (default `newLines` to 1 if not present).
3. Compute hunk new-side range: `[newStart, newStart + newLines - 1]`.
4. Test overlap: `hunk.newStart <= endLine && (hunk.newStart + hunk.newLines - 1) >= startLine`.
5. Collect all overlapping hunks. Reassemble by concatenating the header (`diff --git`, `---`, `+++` lines) with only the relevant `@@ ... @@` sections and their body lines.
6. If no hunks match, return the original `patch` unchanged (fallback).

**Tests** (`client/src/lib/diff-utils.test.ts`):
- Single hunk, finding within range — returns that hunk with header
- Multiple hunks, finding overlaps one — returns only that hunk
- Multiple hunks, finding spans two — returns both hunks
- No hunk overlaps finding — returns full patch (fallback)
- Preserves `diff --git`, `---`, `+++` header lines
- Edge: patch with no hunk headers — returns full patch

**Depends on:** none

---

### Step 2: Wire `extractRelevantHunks` into FindingCard

**Package:** client
**Modify:** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`

In the "Turn into eval case" `onClick` handler (around line 152-166), replace:
```ts
input_diff: fileDiff,
```
with:
```ts
input_diff: extractRelevantHunks(fileDiff, f.start_line, f.end_line),
```

Import `extractRelevantHunks` from `@/lib/diff-utils`.

Manual eval case creation (via "New eval case" button) is unaffected.

**Depends on:** Step 1

---

### Step 3: Fix recall and rewrite precision in `computeBatchMetrics`

**Package:** server
**Modify:** `server/src/modules/evals/scoring.ts`

Two changes in `computeBatchMetrics()`:

#### 3a. Recall (line 200)

Change:
```ts
const recall = totalMustFind === 0 ? null : matchedMustFind / totalMustFind;
```
To:
```ts
const recall = totalMustFind === 0 ? 1.0 : matchedMustFind / totalMustFind;
```

#### 3b. Precision (lines 160-209)

Replace the current precision tracking with new counters:

- `totalMustNotFlag` — count of all `must_not_flag` expectations across all cases
- `satisfiedMustNotFlag` — count of `must_not_flag` expectations where NO actual finding overlaps (silence = correct)
- `unmatchedFindings` — count of actual findings that don't overlap ANY expectation (neither `must_find` nor `must_not_flag`)

Remove the old `findingsMatchingMustFind` and `totalActualFindings` counters.

**New loop body** (inside the `for (const c of cases)` loop):

```ts
// --- must_not_flag ---
const mustNotFlags = c.expected.filter((e) => e.type === 'must_not_flag');
totalMustNotFlag += mustNotFlags.length;
for (const item of mustNotFlags) {
  const match = findMatch(item, c.actual);
  if (!match) satisfiedMustNotFlag++;
}

// --- unmatched findings ---
for (const f of c.actual) {
  const nf = normalizePath(f.file);
  const matchesAny = c.expected.some(
    (e) =>
      normalizePath(e.file) === nf &&
      lineRangeOverlaps(
        { start: e.start_line, end: e.end_line },
        { start: f.start_line, end: f.end_line },
      ),
  );
  if (!matchesAny) unmatchedFindings++;
}
```

**New precision formula:**
```ts
const precisionDenom = totalMustFind + totalMustNotFlag + unmatchedFindings;
const precision = precisionDenom === 0 ? 1.0 : (matchedMustFind + satisfiedMustNotFlag) / precisionDenom;
```

Update the JSDoc comment block above `computeBatchMetrics` to reflect both formula changes.

**Depends on:** none

---

### Step 4: Update and add scoring tests

**Package:** server
**Modify:** `server/src/modules/evals/scoring.test.ts`

#### Update existing tests:

1. **"handles empty cases array" (line 154):** Change `expect(m.recall).toBeNull()` → `expect(m.recall).toBe(1.0)`. Precision stays `1.0`.

2. **"sets recall to null when no must_find expectations (EDGE-8)" (line 198):** Change `expect(m.recall).toBeNull()` → `expect(m.recall).toBe(1.0)`. Precision stays `1.0` (under new formula: `(0 + 1) / (0 + 1 + 0) = 1.0`).

3. **"computes precision correctly" (line 184):** No change needed. Under new formula: `matchedMustFind=1, satisfiedMustNotFlag=0, totalMustFind=1, totalMustNotFlag=0, unmatchedFindings=1`. `precision = 1 / (1 + 0 + 1) = 0.5`. Same result.

4. **"sets precision to null when 0 findings and must_find expectations" (line 212):** Change `expect(m.precision).toBeNull()` → `expect(m.precision).toBe(0)`. Under new formula: `0 / (1 + 0 + 0) = 0.0`.

#### Add new tests:

5. **"precision with must_not_flag satisfied"** — 1 `must_not_flag` expectation, 0 findings. Expected: `precision = (0 + 1) / (0 + 1 + 0) = 1.0`.

6. **"precision with must_not_flag violated"** — 1 `must_not_flag` expectation, 1 finding overlapping it. Expected: `precision = (0 + 0) / (0 + 1 + 0) = 0.0`. The finding overlaps a `must_not_flag`, so it is NOT unmatched (it matched an expectation, just negatively).

7. **"precision with mixed must_find + must_not_flag + noise"** — 1 `must_find` (matched), 1 `must_not_flag` (satisfied), 3 extra findings. Expected: `precision = (1 + 1) / (1 + 1 + 3) = 0.4`.

8. **"precision with only must_not_flag, all satisfied"** — 0 `must_find`, 2 `must_not_flag` (both silent), 0 findings. Expected: `precision = (0 + 2) / (0 + 2 + 0) = 1.0`.

9. **"precision with only must_not_flag, one violated"** — 0 `must_find`, 2 `must_not_flag` (1 silent, 1 flagged), 0 extra findings. Expected: `precision = (0 + 1) / (0 + 2 + 0) = 0.5`.

**Depends on:** Step 3

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Old persisted `recall: null` values in DB | No risk. Old batches keep their `null`. Only future batches get `1.0`. Client already handles `null` with dash display. |
| Old persisted `precision: null` values | Same as above. Old batches retain their values. |
| Precision semantics change confuses old vs new batch comparison | The comparison view's `makeDelta` helper handles `null` inputs gracefully (delta = null when either is null). |
| `extractRelevantHunks` regex fails on unusual patch formats | Fallback behavior (return full patch when no hunks match) handles this gracefully. |

## Out of Scope

- Modifying manual eval case creation flow
- Changing shared Zod contracts in `vendor/shared/`
- Migrating old persisted `recall: null` or `precision: null` values
