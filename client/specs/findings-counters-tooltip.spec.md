# Findings Severity Counters + Tooltip

Compact severity counters on PR rows (list and detail timeline) with a
hover tooltip showing detailed findings filtered by severity.

## Severity Levels

| Severity     | Icon            | Color token     | Label        |
|--------------|-----------------|-----------------|--------------|
| CRITICAL     | AlertOctagon    | `var(--crit)`   | Critical     |
| WARNING      | AlertTriangle   | `var(--warn)`   | Warning      |
| SUGGESTION   | Lightbulb       | `var(--sugg)`   | Suggestion   |

Counters always appear in this order: CRITICAL, WARNING, SUGGESTION.
Only severities with count > 0 are rendered.

## Display Surface 1: PR Detail Timeline

### Position

Inline on each settled run row, replacing the current
`"{count} finding(s) · {count} blockers"` text.

### Content

For each settled run, match `ReviewRecord`s by `run_id`, collect all
findings, group by severity, and render a compact `SeverityBadge` for
each non-zero severity.

### Data Source

Client-side computation from existing `ReviewRecord[]` (already fetched
by `usePrReviews`). The helper `findingsForRun(runId, reviews)` groups
`FindingRecord[]` by severity for a given run.

### Edge Cases

| Condition                          | Behavior                    |
|------------------------------------|-----------------------------|
| Run status = `running`             | No counters                 |
| Run status = `failed`              | No counters (error shown)   |
| Run status = `cancelled`           | No counters                 |
| Run settled, 0 findings            | No counters                 |
| No `ReviewRecord` for this run     | No counters                 |
| Finding is accepted or dismissed   | Counted in badge total      |

## Display Surface 2: PR List — FINDINGS column

### Position

New column after SCORE, before COST.

### Content

Compact `SeverityBadge` for each non-zero severity count, using
`critical_count`, `warning_count`, `suggestion_count` from the
`PrMetaFindings` API response.

### Data Source

Server-side: the `GET /repos/:id/pulls` endpoint returns `PrMetaFindings`
with `critical_count`, `warning_count`, `suggestion_count` (for badge
rendering) and `findings_preview: FindingRecord[]` (for tooltip content).

### Edge Cases

| Condition                  | Behavior                    |
|----------------------------|-----------------------------|
| PR never reviewed          | No badges (column empty)    |
| All counts are 0           | No badges (column empty)    |
| Counts are `null`          | No badges (column empty)    |
| `findings_preview` is null | Badges shown without tooltip|

## Hover Tooltip (PR List + Timeline)

### Trigger

- Hover over any severity counter badge on a timeline run row or PR list row
- 150 ms enter delay, 100 ms leave delay
- Mouse enter shows tooltip; mouse leave hides it

### Position

- Anchored below the hovered badge, left-aligned
- Flips above if insufficient viewport space below

### Content

Header: `"{count} {SEVERITY_LABEL}"` (e.g. "2 Critical")

Body: one card per finding of ONLY the hovered severity:

| Field       | Format                                         |
|-------------|-------------------------------------------------|
| Title       | Bold, primary text, single-line truncated        |
| Category    | `CategoryTag` component (icon + label)           |
| File ref    | Mono, muted — `{file}:{start_line}`             |
| Confidence  | `{n}% conf` (e.g. "98% conf"), muted            |
| Rationale   | First ~120 characters, muted, truncated with "..." |

### Accepted / Dismissed Findings

Findings that have been accepted or dismissed are included in the tooltip
but rendered at reduced opacity (0.45), matching the existing `FindingCard`
muted pattern. The badge count includes all findings regardless of state.

### Styling

| Property       | Value                         |
|----------------|-------------------------------|
| Background     | `var(--bg-elevated)`          |
| Border         | `1px solid var(--border-strong)` |
| Border-radius  | 9px                           |
| Box-shadow     | `var(--shadow-modal)`         |
| Max-height     | 320px (overflow-y: auto)      |
| Width          | 340px                         |
| z-index        | 50                            |
| Animation      | fade-in 120ms ease            |
