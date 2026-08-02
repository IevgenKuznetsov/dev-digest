# Insights

> Draft — entries are under human review. Last updated: 2026-08-02.

- `2026-08-02` **Recurring Errors & Fixes:** `Severity` from `@devdigest/ui` (tokens.ts) is a 4-member union including `"INFO"`, while `Severity` from `@devdigest/shared` (findings.ts) is only 3 members (`CRITICAL|WARNING|SUGGESTION`). Using the UI type to index a map keyed by the shared type causes TS7053 — import from `@devdigest/shared` when working with finding data — `client/src/vendor/ui/primitives/tokens.ts:3`, `client/src/vendor/shared/contracts/findings.ts:11`
- `2026-08-02` **What Doesn't Work:** Absolutely-positioned floating panels (tooltips, popovers) inside the PR list table are clipped because `tableCard` uses `overflow: hidden` for its border-radius. Fix: render via `ReactDOM.createPortal(…, document.body)` and compute position from `getBoundingClientRect()` — `client/src/app/repos/[repoId]/pulls/styles.ts:90`, `client/src/vendor/ui/kit/Tooltip.tsx`