# Insights

> Draft — entries are under human review. Last updated: 2026-08-07.

- `2026-08-07` **Codebase Patterns:** `INJECTION_GUARD` in `prompt.ts` must stay private (`const`, not `export const`). Other modules that need it should use `hardenSystemPrompt(system)` which appends the guard without exposing the constant — exporting it widens the attack surface and violates the "do not touch" rule — `reviewer-core/src/prompt.ts:16,30`
- `2026-08-07` **Codebase Patterns:** When extending `PromptAssembly` with new fields, create a new type in `vendor/shared/contracts/` (e.g. `PromptAssemblyWithIntent`) via `.extend()`. Use that type in `assemblePrompt()` return — never `as PromptAssembly` cast, which hides the field from downstream consumers — `server/src/vendor/shared/contracts/intent-trace.ts`, `reviewer-core/src/prompt.ts:88`