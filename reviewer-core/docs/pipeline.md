# Review Pipeline

Architecture and data-flow reference for `reviewPullRequest()` — the pure engine entry point in `reviewer-core/src/review/run.ts`.

## Overview

```
caller (server ReviewService / CI runner)
  │
  ▼
reviewPullRequest(ReviewInput)          ← engine entry point
  │
  ├─ selectMode()                       ← auto / single-pass / map-reduce
  │
  ├─ assemblePrompt()                   ← prompt.ts
  │   ├─ wrapUntrusted(label, content)  ← delimiter-wraps diff, specs, prDescription
  │   └─ hardenSystemPrompt(system)     ← appends INJECTION_GUARD to every prompt
  │
  ├─ [for each chunk]
  │   └─ llm.completeStructured<Review>(...)   ← structured output with Zod schema
  │       └─ parseWithRepair()                 ← retry loop on parse failure
  │
  ├─ reduceReviews(partials)            ← merge per-file findings (map-reduce path)
  │
  └─ groundFindings(merged, diff)       ← citation grounding gate (mandatory)
       └─ scoreFromFindings(kept)       ← 100 − (CRITICAL×35 + WARNING×12 + SUGGESTION×3)
```

## Strategy Selection

`selectMode()` picks the review strategy before any LLM calls:

| Input | Strategy | Behavior |
|-------|----------|----------|
| `strategy: 'single-pass'` (explicit) | single-pass | One LLM call, whole diff |
| `strategy: 'map-reduce'` (explicit), 1 file | single-pass | Degrades gracefully |
| `strategy: 'map-reduce'` (explicit), N files | map-reduce | One call per file |
| `strategy: 'auto'` (default) | single-pass | diff ≤ 400 lines OR single file |
| `strategy: 'auto'` (default) | map-reduce | diff > 400 lines AND multi-file |

Threshold is overridable via `ReviewInput.mapThresholdLines` (default: `DEFAULT_MAP_THRESHOLD_LINES = 400`).

## Key Types

### `ReviewInput`

Everything the engine needs, injected by the caller:

| Field | Required | Description |
|-------|----------|-------------|
| `systemPrompt` | Yes | Trusted agent system prompt |
| `model` | Yes | Model ID (e.g. `deepseek/deepseek-v4-flash`) |
| `diff` | Yes | Parsed `UnifiedDiff` with new-side line numbers |
| `llm` | Yes | Injected `LLMProvider` — the only I/O the engine performs |
| `strategy` | No | `'auto'` (default), `'single-pass'`, `'map-reduce'` |
| `skills` | No | Resolved skill bodies (NOT slugs — caller resolves) |
| `memory` | No | Curated memory items |
| `specs` | No | Project-context spec chunks (untrusted, delimiter-wrapped) |
| `callers` | No | Callers-of-changed-symbols digest (untrusted) |
| `repoMap` | No | Repo skeleton (untrusted, rendered before project context) |
| `prDescription` | No | PR author's description (untrusted, capped at 4000 chars) |
| `prIntent` | No | Intent classifier output (untrusted) |
| `checkCancelled` | No | Called before each LLM call; THROWS to abort |
| `onEvent` | No | Progress sink (`ReviewEvent` — kind, msg, data) |

### `ReviewOutcome`

Returned on success:

| Field | Description |
|-------|-------------|
| `review` | Reduced, GROUNDED `Review` (only findings that passed citation gate) |
| `grounding` | Human-readable summary, e.g. `"3/4 passed"` |
| `dropped` | Findings rejected by grounding, with reasons |
| `mode` | `'single-pass'` or `'map-reduce'` — which path actually ran |
| `assembly` | Prompt assembly (single-pass: the call; map-reduce: whole-diff assembly) |
| `tokensIn / tokensOut / costUsd` | Aggregated across all LLM calls |
| `raw` | Joined raw model outputs (for run trace) |

## Prompt Assembly (`prompt.ts`)

`assemblePrompt()` builds the `messages` array passed to the LLM:

1. System prompt (trusted) + `INJECTION_GUARD` appended via `hardenSystemPrompt()`
2. Skills section (trusted-ish)
3. Memory section (trusted)
4. Repo map — `wrapUntrusted('repo-map', repoMap)` if provided
5. Project context / specs — `wrapUntrusted('spec', chunk)` per chunk
6. PR intent — `wrapUntrusted('intent', prIntent)` if provided
7. PR description — `wrapUntrusted('pr-description', body)`, capped at 4 000 chars
8. Diff — `wrapUntrusted('diff', diffText)`

All external content goes through `wrapUntrusted()`, which:
- Wraps in `<untrusted source="...">…</untrusted>` delimiters
- Escapes any `</untrusted>` closers inside the content

## Grounding Gate

`groundFindings()` is a **mandatory** post-step, not optional post-processing. It drops findings whose cited file path or line range does not appear in the actual diff. This prevents hallucinated citations from reaching the user.

The score is computed from the **grounded** findings (`scoreFromFindings(ground.kept)`), never from the model's self-reported score and never from the pre-grounding set. The three values — score, findings list, and deterministic event — always agree.

## Cancellation

Cancellation is checkpoint-based: `checkCancelled()` is called **before each chunk's LLM call**. The caller supplies a function that throws (e.g. the server's `RunCancelledError`). The engine stays agnostic to the error type — it propagates whatever the caller throws.

## What the Engine Does NOT Do

The engine has zero side effects beyond the injected `LLMProvider`:

- No DB reads or writes
- No GitHub API calls
- No filesystem access
- No SSE streaming (caller wires `onEvent` to the SSE bus)
- No intent classification (caller resolves `prIntent` before calling)
- No skill slug resolution (caller resolves skill bodies before calling)
- No memory retrieval (caller passes curated `memory` items)
