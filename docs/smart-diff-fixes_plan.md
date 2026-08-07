# Implementation Plan: Smart Diff Fixes

**Scope:** client
**Estimated complexity:** low
**Created:** 2026-08-07

## Context

The Smart Diff feature was recently implemented but has three issues:
1. The toggle between flat and SmartDiff view is hidden until data loads — users don't know it exists. User wants a **segmented control** always visible.
2. In SmartDiff mode, ALL files are shown. User wants **only files with findings** displayed.
3. File-level expand/collapse ignores the group role. User wants Core/Wiring files **expanded**, Boilerplate files **collapsed**.

When no review has been run (zero findings), SmartDiff should show an **empty state message** ("No findings yet. Run a review or switch to Flat view.").

This is a client-only fix. No server changes, no schema changes, no new contracts.

## Architecture Constraints

- `vendor/shared/` and `vendor/ui/` are read-only — never edit existing files. Source: root `CLAUDE.md`, client `CLAUDE.md`.
- Styles use inline CSSProperties with CSS variables. Source: client `CLAUDE.md`.
- `FileCard` is NOT exported from the `@/components/diff-viewer` barrel — import via `@/components/diff-viewer/FileCard`. Source: client `INSIGHTS.md`.
- Pages are thin; logic lives in colocated `_components/`. Source: client `CLAUDE.md`.

## Pre-implementation Checklist

- [ ] Migration needed? **No**
- [ ] New module needed? **No**
- [ ] New shared contracts needed? **No**
- [ ] New adapter needed? **No**

## Steps

### Step 1: Replace ghost button toggle with segmented control in DiffTab

**Package:** client
**Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` (modify)
**What:** Replace the conditional `{smartDiff && <Button ...>}` toggle (lines 55-64) with a two-option segmented control that is **always visible**. Options: "Flat" and "Smart Diff". Disable the "Smart Diff" option while `smartDiffLoading` is true or `smartDiff` is falsy.

Implementation:
- Create a simple inline segmented control using two `<button>` elements styled as a pill group (no new component — keep it in DiffTab since it's small)
- Active segment gets `background: var(--accent-bg)`, `color: var(--accent)`; inactive gets transparent
- The "Smart Diff" segment is disabled (greyed out) when `!smartDiff || smartDiffLoading`
- State: reuse existing `groupedView` boolean
- Styles: inline CSSProperties following the project pattern

**Skills:** `react-best-practices`, `typescript-expert`
**Tests:** Manual verification — toggle always visible, disabled while loading, switches views.
**Depends on:** none

### Step 2: Filter SmartDiffViewer to only show files with findings + empty state

**Package:** client
**Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.tsx` (modify)
**What:** Filter each group's files to only those with `finding_lines.length > 0`. If no files have findings across all groups, show an empty state message.

Specific changes:
- Inside `ROLE_ORDER.map(...)`, after getting `group`, compute `const filesWithFindings = group.files.filter(f => f.finding_lines.length > 0)`
- If `filesWithFindings.length === 0`, return `null` (skip group)
- Use `filesWithFindings` for file count badge, totalFindings, and the file list render
- After the map, if all groups were skipped (no findings anywhere), render an empty state: a centered message like "No findings yet. Run a review or switch to Flat view to see all files."
- Style the empty state with `color: var(--text-muted)`, `textAlign: center`, `padding: 40px`

**Skills:** `react-best-practices`, `typescript-expert`
**Tests:** Update `SmartDiffViewer.test.tsx`:
- Update test fixtures: Wiring group has `finding_lines: []`, so it will be hidden — adjust assertions
- Add test: "hides groups where no files have findings"
- Add test: "shows empty state when no files have findings at all"
- Update file count badge tests to reflect filtered counts
**Depends on:** none

### Step 3: Add `defaultExpanded` prop to FileCard

**Package:** client
**Files:** `client/src/components/diff-viewer/FileCard/FileCard.tsx` (modify)
**What:** Add an optional `defaultExpanded?: boolean` prop that overrides the auto-expand heuristic when provided.

Specific change to `useState` initializer:
```
const [open, setOpen] = React.useState(
  defaultExpanded ?? (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
);
```

Backward-compatible: existing consumers (`DiffViewer`) don't pass it, so they keep the current behavior.

**Skills:** `react-best-practices`, `typescript-expert`
**Tests:** No existing FileCard test file. Change is minimal. Verified via SmartDiffViewer test in Step 4.
**Depends on:** none

### Step 4: Pass `defaultExpanded` from SmartDiffViewer based on group role

**Package:** client
**Files:**
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/constants.ts` (modify)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/_components/SmartDiffViewer/SmartDiffViewer.tsx` (modify)

**What:** Add a `FILE_DEFAULT_EXPANDED` constant mapping role to boolean, then pass it to FileCard.

In `constants.ts`, add:
```ts
export const FILE_DEFAULT_EXPANDED: Record<SmartDiffRole, boolean> = {
  core: true,
  wiring: true,
  boilerplate: false,
};
```

In `SmartDiffViewer.tsx`, at the `<FileCard>` render site:
```tsx
<FileCard
  file={prFile}
  commenting={commenting}
  defaultExpanded={FILE_DEFAULT_EXPANDED[role]}
/>
```

**Skills:** `react-best-practices`, `react-frontend-best-practices`, `typescript-expert`
**Tests:** Update `SmartDiffViewer.test.tsx`:
- Update FileCard mock to expose `defaultExpanded` via `data-expanded` attribute
- Add test: "passes defaultExpanded=true to FileCards in core group"
- Add test: "passes defaultExpanded=false to FileCards in boilerplate group"
**Depends on:** Step 3

## Proactive Skills That Will Fire

- `engineering-insight` — **will fire** (4+ files modified)
- `breaking-change` — **will not fire** (no routes or contracts changed)
- `response-schema` — **will not fire** (no API response shapes changed)

## Risk Assessment

- **Risk: SmartDiff shows nothing before first review** — All files have zero findings, so the filter hides everything. **Mitigation:** Empty state message directs users to run a review or switch to flat view. Toggle always visible so they can switch back.
- **Risk: Test fixture mismatch** — Existing tests expect Wiring group to be visible, but it has no findings. **Mitigation:** Update fixtures and assertions in Step 2.
- **Risk: `defaultExpanded` ignored on re-render** — `useState` only uses its initializer on mount. **Mitigation:** FileCard is keyed by path, so React unmounts/remounts on key change. Initial state is the correct pattern here.

## Out of Scope

- Server-side changes — client-only fix
- New vendor/ui components — segmented control is inline, not a reusable primitive
- Empty state design polish — basic message is sufficient for now
