# Spec: Eval Scoring V2 — Hunk Extraction & Metric Fixes

Spec ID: EvalScoringV2_1
Status: draft
Supersedes: portions of EvalPipeline_1 (scoring formulas, diff capture)

## Problem

Three issues with the current eval system:

1. **Whole-file diff captured** — When creating an eval case from a finding, `fileDiffMap` passes the entire file patch (all hunks). Eval cases should contain only the hunk(s) relevant to the finding, reducing noise and making cases focused.

2. **Recall returns `null` when no `must_find` expectations** — A batch of pure `must_not_flag` cases produces `recall: null`, which is misleading. If there's nothing to recall, recall should be `1.0` (perfect — nothing was missed).

3. **Precision ignores `must_not_flag`** — Current formula: `matched_must_find / total_findings`. A finding that lands on a `must_not_flag` region is a false positive but isn't penalized differently from an unmatched finding. Precision should credit silence on `must_not_flag` regions and penalize violations.

## Changes

### Change 1: Hunk-scoped diff extraction

**Where:** `FindingCard.tsx` — the `onClick` handler for "Turn into eval case"

**Current behavior:** `input_diff` is set to `fileDiff` (the entire file patch from `fileDiffMap`).

**New behavior:** Extract only the hunk(s) whose new-side line range overlaps with the finding's `[start_line, end_line]`. Pass the extracted hunk(s) as `input_diff` instead of the full file patch.

#### Extraction logic

Given a file patch string and a finding's `[start_line, end_line]`:

1. Parse the patch into individual hunks. Each hunk starts with `@@ -old,len +new,len @@`.
2. For each hunk, compute its new-side line range: `[newStart, newStart + newLines - 1]`.
3. A hunk is **relevant** if its new-side range overlaps the finding's range (inclusive):
   `hunk.newStart <= finding.end_line AND (hunk.newStart + hunk.newLines - 1) >= finding.start_line`
4. Collect all relevant hunks. Reassemble them into a valid unified diff fragment:
   - Preserve the `diff --git`, `---`, `+++` header from the original patch
   - Include only the relevant `@@ ... @@` sections with their lines
5. If no hunks match (edge case — finding line range doesn't overlap any hunk), fall back to the full file patch.

#### Where to put the extraction function

Add a pure helper `extractRelevantHunks(patch: string, startLine: number, endLine: number): string` in a shared client utility (e.g., alongside existing diff helpers). This keeps `FindingCard` clean.

#### Impact on manual creation

Manual eval case creation (via "New eval case" button) is **unchanged** — user pastes whatever diff they want. This change only affects the "Turn into eval case" flow from FindingCard.

---

### Change 2: Recall — `1.0` when no `must_find` expectations

**Where:** `server/src/modules/evals/scoring.ts` → `computeBatchMetrics()`

**Current (line 200):**
```ts
const recall = totalMustFind === 0 ? null : matchedMustFind / totalMustFind;
```

**New:**
```ts
const recall = totalMustFind === 0 ? 1.0 : matchedMustFind / totalMustFind;
```

**Rationale:** If there are no `must_find` expectations, nothing was missed → recall is perfect. This avoids `null` propagating into dashboard aggregations and trend charts.

---

### Change 3: Precision — account for `must_not_flag`

**Where:** `server/src/modules/evals/scoring.ts` → `computeBatchMetrics()`

**Current formula:**
```
precision = findings_matching_must_find / total_actual_findings
```
Only credits true positives (findings matching `must_find`). `must_not_flag` regions are invisible.

**New formula:**
```
precision = (matched_must_find + satisfied_must_not_flag) / (total_must_find + total_must_not_flag + unmatched_findings)
```

Where:
- `matched_must_find` = count of `must_find` expectations that have an overlapping actual finding
- `satisfied_must_not_flag` = count of `must_not_flag` expectations that have **no** overlapping actual finding (silence = correct)
- `total_must_find` = total `must_find` expectations across all cases
- `total_must_not_flag` = total `must_not_flag` expectations across all cases
- `unmatched_findings` = actual findings that don't overlap **any** expectation (neither `must_find` nor `must_not_flag`)

**Division-by-zero guard:** If `total_must_find + total_must_not_flag + unmatched_findings === 0` → `precision = 1.0` (no expectations, no findings → nothing wrong).

#### Worked examples

**Example A — mixed expectations, clean run:**
- Case: 1 `must_find` (matched), 1 `must_not_flag` (no finding in region), 0 extra findings
- `precision = (1 + 1) / (1 + 1 + 0) = 1.0` ✓

**Example B — must_not_flag violated:**
- Case: 1 `must_find` (matched), 1 `must_not_flag` (finding in region!), 0 extra findings
- `matched_must_find=1`, `satisfied_must_not_flag=0`, `unmatched_findings=0`
- But the finding that hit `must_not_flag` is an actual finding — does it count as unmatched?
- **Clarification:** A finding that overlaps a `must_not_flag` region is NOT counted as `unmatched_findings` (it matched an expectation, just the wrong way). It reduces precision by **not** contributing to `satisfied_must_not_flag`.
- `precision = (1 + 0) / (1 + 1 + 0) = 0.5` ✓

**Example C — extra noise findings:**
- Case: 1 `must_find` (matched), 0 `must_not_flag`, 3 extra findings hitting no expectation
- `precision = (1 + 0) / (1 + 0 + 3) = 0.25` — penalizes noise ✓

**Example D — only must_not_flag, all satisfied:**
- Case: 0 `must_find`, 2 `must_not_flag` (both silent), 0 findings
- `precision = (0 + 2) / (0 + 2 + 0) = 1.0` ✓

**Example E — only must_not_flag, one violated:**
- Case: 0 `must_find`, 2 `must_not_flag` (1 silent, 1 flagged), 0 extra findings
- `precision = (0 + 1) / (0 + 2 + 0) = 0.5` ✓

---

## Files to modify

| File | Change |
|------|--------|
| `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` | Call `extractRelevantHunks()` on `fileDiff` before setting `input_diff` |
| `client/src/lib/utils/diff.ts` (new) | Add `extractRelevantHunks(patch, startLine, endLine): string` |
| `server/src/modules/evals/scoring.ts` | Change recall null→1.0; rewrite precision formula |
| `server/src/modules/evals/scoring.test.ts` | Update existing tests, add new tests for precision formula |

## Tests to add/update

### Unit: `extractRelevantHunks`
- Single hunk, finding within → returns that hunk
- Multiple hunks, finding overlaps one → returns only that hunk
- Multiple hunks, finding spans two → returns both
- No hunk overlaps finding → returns full patch (fallback)
- Preserves diff header (`diff --git`, `---`, `+++`)

### Unit: `scoring.test.ts`
- `computeBatchMetrics` — recall returns `1.0` when no `must_find` (update existing EDGE-8 test)
- `computeBatchMetrics` — precision with `must_not_flag` satisfied (new)
- `computeBatchMetrics` — precision with `must_not_flag` violated (new)
- `computeBatchMetrics` — precision with mixed `must_find` + `must_not_flag` + noise (new)
- `computeBatchMetrics` — precision `1.0` for empty case (update existing test)
- `computeBatchMetrics` — precision with only `must_not_flag`, all satisfied (new)

## Open questions

None — all three changes are scoped and independent.
