# @devdigest/reviewer-core

Pure review engine. No DB, no GitHub, no filesystem. Only side effect: injected LLMProvider.

## Tech stack

Zod (structured output schema), OpenAI SDK (OpenRouter provider). Zero other runtime deps.

## Commands

```sh
npm test          # vitest — stubbed LLM, no keys, no network
npm run typecheck # this IS the build (never emits JS)
```

## Conventions

- Consumed by server as raw TypeScript via tsconfig alias. Never compiled to JS.
- All external content must go through `wrapUntrusted(label, content)`.
  It escapes `</untrusted>` closers in content.
- Score is always `scoreFromFindings(grounded)`: 100 − (CRITICAL×35 + WARNING×12 + SUGGESTION×3).
  The model's self-reported score is discarded.
- Strategy selection: map-reduce only when BOTH diff > 400 lines AND multi-file.
- Cancellation is checkpoint-based: `checkCancelled()` before each LLM call.
  Caller owns the error type.

## Gotchas

- The output schema is enforced via `response_format: json_schema`, NOT in the prompt text.
  Agent prompts must not describe JSON shape — it conflicts and produces garbage.
- `parseWithRepair` appends the error + reprompt to message history on failure.
  It's not a raw retry.
- Full-file scanner kinds (`secret_leak`, `lethal_trifecta`, `phantom`, `hook`) bypass
  line-range grounding. They only need the file to exist in the diff.

## Do not touch

- `INJECTION_GUARD` constant in `prompt.ts` — shared, trusted defense appended
  to every agent prompt. Change here = change for all agents everywhere.
- `groundFindings()` — mandatory gate, not optional post-processing.
- `scoreFromFindings()` — the single source of truth for review scores.
