# Spec: Risk Brief

Spec ID: RiskBrief_1
Status: draft
Supersedes: ---

## Problem and User

A PR reviewer opening the Overview tab today sees two cards -- IntentCard (what this PR aims to do) and BlastCard (what code is affected downstream) -- but has no single, consolidated view that synthesizes the risk picture: what changed, why, how dangerous it is, and what files to inspect first. Reviewers must mentally combine intent, blast, and findings data to triage their review, which is slow and error-prone for large PRs.

The target user is a **code reviewer** who wants to quickly assess PR risk and decide where to start reading. A secondary user is a **team lead** scanning multiple PRs for risk triage.

## Goals / Non-goals

### Goals
- Provide a single AI-generated brief card on the PR Overview tab that synthesizes what changed, why, risk level, risk areas, and prioritized review focus items.
- Surface a findings/blockers summary row (mechanically computed, not AI-generated) so reviewers see at a glance whether any critical findings exist.
- Enable one-click navigation from risk areas and review focus items to the exact file and line in the Files Changed tab.
- Display a "What this does" annotation per file in the Files Changed tab (SmartDiffViewer) when `pseudocode_summary` is populated.
- Cache briefs by `(pr_id, head_sha)` so the same brief is not regenerated for unchanged code.

### Non-goals
- **Not replacing IntentCard or BlastCard** -- PrBriefCard is additive. The existing cards remain untouched and independently functional.
- **Not auto-generating briefs** -- generation is manual (user-initiated) only. No auto-trigger on page load, PR open, or push events.
- **Not auto-regenerating on push** -- when `head_sha` changes, the card shows a stale badge and a manual regenerate button. No automatic re-run.
- **Not modifying existing contracts** -- `RiskSeverity` in `brief.ts` is not touched. A new `BriefRiskLevel` enum lives in a new contract file.
- **Not modifying the existing `pr_brief` table** -- a new `pr_risk_brief` table is created.
- **Not providing LLM-generated findings** -- the findings/blockers summary row is mechanically computed from the existing `findings` table.

## User stories

- As a code reviewer, I want to see a concise AI-generated brief at the top of the PR Overview tab, so that I can understand what changed, why, and how risky it is before diving into code.
- As a code reviewer, I want the brief to list specific risk areas with file:line links, so that I can navigate directly to the most dangerous parts of the PR.
- As a code reviewer, I want a numbered review focus list with notes, so that I know which files to inspect first and what to look for in each.
- As a code reviewer, I want to see a findings/blockers summary row, so that I can immediately see whether any critical-severity findings exist without switching tabs.
- As a code reviewer, I want to click any file:line link in the brief and land on the exact location in the Files Changed tab, so that I don't waste time searching.
- As a code reviewer, I want to see a "What this does" annotation per file in the Files Changed tab, so that I understand each file's role in the PR at a glance.
- As a code reviewer, I want the brief to show a stale badge when the PR has been updated (new `head_sha`), so that I know the brief may not reflect the latest changes.
- As a code reviewer, I want to manually regenerate the brief when it is stale, so that I get an up-to-date risk assessment without losing visibility of the old brief during regeneration.

## Acceptance criteria (EARS)

### Ubiquitous (always true, no trigger)

- The PrBriefCard shall be positioned above the IntentCard/BlastCard row in the Overview tab, spanning full width.
- The PrBriefCard shall display five sections when a brief exists: "What changed" (text), "Why" (text), risk level badge, risk areas list (file:line links), and review focus list (numbered file:line items with notes).
- The PrBriefCard shall display a findings/blockers summary row below the brief sections, showing counts of critical-severity findings (blockers) and total findings.
- The findings/blockers summary row shall be mechanically computed from the existing `findings` table data passed as a prop from the parent page -- it shall not be part of the LLM response.
- The `BriefRiskLevel` enum shall be defined as `z.enum(['low', 'medium', 'high', 'critical'])` in a new contract file `brief-response.ts` in `server/src/vendor/shared/contracts/`.
- The risk level badge shall use visually distinct colors for each level (low, medium, high, critical).
- Each risk area item shall display a file path and optional line number as a clickable link.
- Each review focus item shall display a numbered index, a file path and optional line number as a clickable link, and an explanatory note.
- The `pr_risk_brief` table shall use a composite key of `(pr_id, head_sha)` and store the brief in a JSONB `brief` column.

### Event-Driven (triggered by an event)

- When the user clicks the "Generate brief" button on a never-generated PrBriefCard, the client shall POST to `/pulls/:id/brief` with a minimal or empty body and transition the card to the in-progress (skeleton) state.
- When the POST `/pulls/:id/brief` request is received, the server shall assemble inputs internally by fetching the PR's intent text, blast summary, diff stats, linked issue, and relevant project context documents from the database and project-context service.
- When any input source (intent, blast, linked issue, context docs) is unavailable, the server shall proceed with best-effort assembly using whatever inputs are available and may include a `sources` metadata object in the response indicating which inputs were present.
- When inputs are assembled, the server shall make a single structured LLM call that returns a `Brief` object containing `what` (string), `why` (string), `risk_level` (BriefRiskLevel), `risks[]`, and `review_focus[]`.
- When the LLM responds, the server shall validate all `risks[].file_refs` paths and `review_focus[].file` paths against the actual PR file list (from `pr_files` table) and strip any paths that do not match, logging a warning for each stripped path.
- When the LLM call completes successfully, the server shall persist the validated brief to the `pr_risk_brief` table with the current `pr_id` and `head_sha`, and return the brief in the response.
- When the brief response is received by the client, the PrBriefCard shall render the brief content, replacing the skeleton state.
- When the brief generation completes, the server shall emit a structured info-level log entry containing: `model`, `prompt_tokens`, `completion_tokens`, `latency_ms`, `inputs_present` (object listing which inputs were available), and `file_refs_stripped` (count of paths removed during validation).
- When the user clicks a file:line link in the risk areas or review focus sections, the client shall navigate to the Files Changed tab using query parameters `?tab=diff&file=<path>&line=<line>`, matching the existing BlastCard `handleFileClick` pattern.
- When the user clicks the "Regenerate" button on a stale or completed brief, the client shall POST to `/pulls/:id/brief`, keeping the old brief visible with an overlay spinner and the regenerate button disabled until the response arrives.
- When `SmartDiffFile.pseudocode_summary` is non-null for a file, the SmartDiffViewer shall render a "What this does" annotation above or below the file header displaying the summary text.

### State-Driven (true while a condition holds)

- While the PrBriefCard has never been generated (no cached brief for this PR), the card shall display an empty state with a "Generate brief" button.
- While the brief generation request is in progress, the PrBriefCard shall display a skeleton loading state.
- While brief regeneration is in progress, the PrBriefCard shall continue to display the previous brief content with a semi-transparent overlay spinner, and the regenerate button shall be disabled.
- While the cached brief's `head_sha` does not match the PR's current `head_sha`, the PrBriefCard shall display the existing brief with a visible "Outdated" badge and an enabled "Regenerate" button.
- While the "Generate brief" or "Regenerate" button has been clicked and the request is in flight, the button shall be disabled on the client to prevent duplicate submissions.

### Optional Feature (conditional on feature presence)

- Where the smart-diff classifier is available, it shall populate `SmartDiffFile.pseudocode_summary` with a short plain-English summary describing what each file does in the context of the current PR.

### Unwanted Behavior (error/fault handling)

- If the POST `/pulls/:id/brief` request fails (network error, server error, LLM failure), then the PrBriefCard shall display a toast error notification and remain in its prior state (never-generated empty card, or previously cached brief).
- If the LLM returns `risks[]` or `review_focus[]` items with file paths not present in the PR's file list, then the server shall strip those items, log a warning for each stripped path, and return the brief with only validated items.
- If the LLM returns more than 10 risk areas or more than 15 review focus items, then the LLM prompt shall instruct it to cap at these limits (enforcement is via prompt engineering, not server-side truncation).
- If the server receives a POST `/pulls/:id/brief` request while another request for the same PR is already in progress, then the server shall apply standard per-route rate limiting and reject the duplicate request.

## Edge cases

| # | Scenario | Expected behavior |
|---|----------|-------------------|
| 1 | PR has no intent, no blast, no linked issue, and no context docs (all inputs missing) | Server proceeds with best-effort; LLM receives minimal context. Brief may be shallow but is still generated. Response may include `sources` metadata showing no inputs were available. |
| 2 | LLM returns all file paths that do not exist in the PR | All `risks[].file_refs` and `review_focus[].file` entries are stripped. Brief is returned with empty `risks` and `review_focus` arrays. Warning logged with count of stripped paths. |
| 3 | PR is updated (new `head_sha`) while the user is viewing an existing brief | Brief remains visible with "Outdated" badge. No automatic regeneration. User can manually regenerate. |
| 4 | User clicks "Generate brief" but the network request fails | Toast error shown. Card stays in never-generated state with the "Generate brief" button re-enabled. |
| 5 | User clicks "Regenerate" but the request fails | Toast error shown. Previous brief remains fully visible (overlay spinner removed). Regenerate button re-enabled. |
| 6 | Multiple users/tabs trigger brief generation for the same PR simultaneously | Server rate limits per route. First request proceeds; subsequent concurrent requests are rejected with appropriate HTTP status. Client shows toast for rejected requests. |
| 7 | PR has zero files (edge case in data) | Server returns an error or empty brief since there is nothing to analyze. Card shows appropriate empty/error state. |
| 8 | `pseudocode_summary` is null for all files in SmartDiffViewer | No "What this does" annotations rendered. SmartDiffViewer behaves exactly as it does today. |
| 9 | Brief exists in cache but findings have changed since brief was generated | The findings/blockers summary row always reflects current findings data (passed as prop), not the cached brief. The brief's AI-generated content (what, why, risks, review_focus) reflects the cached state and may be stale relative to findings. |
| 10 | User navigates away from PR page during brief generation and returns | If generation completed, cached brief is displayed. If still in progress or failed, card shows appropriate state based on cache lookup (never-generated if no cache entry). |

## Non-functional requirements

- **Performance**: The POST `/pulls/:id/brief` endpoint involves a single LLM call; latency depends on the model but should complete within a reasonable timeout (consistent with other LLM-backed endpoints in the system). The client must not block the page while the brief is generating -- the rest of the Overview tab remains interactive.
- **Security**: The endpoint requires workspace authentication via `getContext(container, req)` consistent with all other module routes. No user-supplied free text is sent in the POST body (server assembles all inputs), minimizing prompt injection surface. LLM output is rendered as plain text, not as raw HTML or markdown that could execute scripts.
- **Accessibility**: The "Generate brief" and "Regenerate" buttons must be keyboard-focusable and activatable via Enter/Space. The risk level badge must have sufficient color contrast and include a text label (not color-only). File:line links must be keyboard-navigable. The overlay spinner during regeneration must have an `aria-label` indicating loading state.

## Inputs and provenance

| Input | Source | Format |
|-------|--------|--------|
| Intent text (summary, in_scope, out_of_scope, risk_areas) | `pr_intent` table (server-side) | `EnrichedIntent` contract fields |
| Blast summary | `pr_brief.json` blast field or blast-radius computation (server-side) | `BlastRadius.summary` string |
| Diff stats (additions, deletions, files_count) | `pull_requests` table (server-side) | integers |
| PR file list | `pr_files` table (server-side) | array of file paths |
| Linked issue body | GitHub API / cached PR body (server-side) | string or null |
| Project context documents | `project_context` / context-doc service (server-side) | `SpecReadEntry[]` with content |
| Findings (for summary row) | `findings` table via existing API (client-side, passed as prop) | `FindingRecord[]` |
| Current head_sha | `pull_requests.head_sha` (server-side for cache key; client-side for stale detection) | string |

## Untrusted inputs

| Input | Risk | Validation |
|-------|------|------------|
| LLM-generated `what` and `why` text | Could contain misleading content, prompt injection artifacts, or XSS payloads if rendered as HTML | Render as plain text only. Do not interpret as HTML or markdown. Zod-validate the Brief response schema before use. |
| LLM-generated `risks[].file_refs` and `review_focus[].file` paths | Could reference files outside the PR (path traversal, misleading navigation) | Server-side post-validation: filter against actual PR file list from `pr_files` table. Strip and log unrecognized paths. |
| LLM-generated `risk_level` | Could return an unexpected value outside the enum | Zod enum validation (`z.enum(['low', 'medium', 'high', 'critical'])`) rejects invalid values. |
| LLM-generated `risks[]` and `review_focus[]` array sizes | Could return excessively large arrays consuming UI space | LLM prompt caps at 10 risks and 15 review focus items. No server-side truncation, but Zod schema could optionally enforce `.max()` as a safety net. |
| `pr_id` URL parameter | Could reference a PR in another workspace | Validated via `getContext(container, req)` which scopes all queries to the authenticated workspace. |

## Open questions

- [ ] **Prompt design**: The exact LLM prompt for brief generation (system message, user message template, structured output schema) is an implementation detail to be determined by the implementor. The spec defines the output shape and input data, not the prompt wording.
- [ ] **Model selection**: Which LLM model should be used for brief generation? Should it use the same model configured for the review agent, or a separate model setting? This is an implementation decision.
- [ ] **Timeout handling**: What is the appropriate timeout for the LLM call? Should it match existing LLM call timeouts in the review pipeline, or have a separate configuration?
- [ ] **`pseudocode_summary` population scope**: The spec requires the smart-diff classifier to populate `pseudocode_summary`. The classifier currently sets this to `null`. The implementation must determine whether this requires an additional LLM call within the classifier or can piggyback on existing classification logic. This is an implementation decision.
- [ ] **Sources metadata shape**: The spec mentions the response "may include sources metadata" indicating which inputs were present. The exact shape of this metadata object is an implementation decision.
- [ ] **Relationship to existing `pr_brief` table**: The existing `pr_brief` table (single `prId` primary key, JSONB `json` column) stores composed brief data (intent + blast + risks + history). The new `pr_risk_brief` table is separate and stores the AI-generated risk brief. Whether the existing `pr_brief` data is used as an input source (e.g., reading blast summary from it) or whether inputs are fetched from their original tables is an implementation decision.
- [ ] **Concurrent generation guard**: The spec says "standard per-route rate limiting" handles concurrent requests. Whether an additional application-level mutex (e.g., checking for in-progress generation in the DB) is needed is an implementation decision.
