# reviewer-core Gotchas

Non-obvious behaviors and traps encountered while working in this package. Check here first when something behaves unexpectedly.

## Output schema is enforced via `response_format`, not the prompt

The structured output schema is passed as `response_format: json_schema` in the LLM request. **Do not describe the JSON shape in the agent system prompt** — it conflicts with the schema enforcement and produces garbage output or parse failures. Let the schema speak for itself.

## `parseWithRepair` is not a raw retry

When structured output parsing fails, `parseWithRepair` appends the error + a reprompt to the message history before the next attempt. It is a repair loop, not a blind retry. Each attempt costs tokens — keep `maxRetries` low (default: 2).

## Full-file scanner findings bypass line-range grounding

The scanner kinds `secret_leak`, `lethal_trifecta`, `phantom`, and `hook` are file-level checks. Their findings only need the file to exist in the diff — no specific line range is required. The grounding gate knows this and will NOT drop them for missing line citations.

## `ReviewOutcome.assembly` is typed as `PromptAssembly` (base), not the extended type

If you extend `PromptAssembly` with new fields via `.extend()` (e.g. `PromptAssemblyWithIntent` in `intent-trace.ts`), those fields silently disappear from `ReviewOutcome.assembly` unless you also update the type annotation in `review/run.ts:ReviewOutcome`. Always update both places: `prompt.ts:AssembledPrompt` AND `review/run.ts:ReviewOutcome`.

## `INJECTION_GUARD` must stay private

`INJECTION_GUARD` is declared as `const` (not `export const`) in `prompt.ts`. Other modules that need to harden a system prompt must call `hardenSystemPrompt(system)`, which appends the guard without exposing the constant. Exporting it widens the attack surface and violates the "do not touch" constraint.

## Extending `PromptAssembly` — use `.extend()`, never a cast

When adding new fields to the assembly, create a new type in `vendor/shared/contracts/` via `.extend()` (e.g. `PromptAssemblyWithIntent`) and use that type in `assemblePrompt()`'s return. Never use `as PromptAssembly` to cast — it hides the new fields from downstream consumers.

## Score is from grounded findings only

`scoreFromFindings()` is called on `ground.kept` — the set that survived the citation grounding gate. The model's self-reported score is always discarded. The pre-grounding finding set is also never scored. If your score seems lower than expected, check how many findings the grounding gate dropped (`ReviewOutcome.dropped`).

## Strategy `'map-reduce'` with a single file degrades to `'single-pass'`

Explicitly setting `strategy: 'map-reduce'` when the diff touches only one file still runs as `'single-pass'`. This is intentional — map-reduce over a single file just adds overhead.
