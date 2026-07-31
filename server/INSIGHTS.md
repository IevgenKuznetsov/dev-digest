# Insights — @devdigest/api

Non-obvious decisions, architectural traps, and things that look wrong but aren't.

## Secrets are NOT in AppConfig

**What:** API keys flow through `SecretsProvider` (`adapters/secrets/local.ts`), not env/config validation.
**Why:** Keys can be set at runtime via the Settings UI; putting them in Zod config would require a restart.
**Trap:** Adding a key to `loadConfig()` breaks the "boot with no keys" guarantee.

## Orphan run reaping is AWAITED on boot

**What:** Before accepting requests, all `status:"running"` agent_run rows are marked failed.
**Why:** Single-instance app; any "running" row at boot is from a crashed previous process.
**Trap:** Making it async creates a race — a brand-new run could be created and wrongly reaped before the reaper finishes.

## Modules are statically registered (no autoload)

**What:** `modules/index.ts` manually lists every plugin import.
**Why:** `import()` of `.ts` files isn't portable across tsx, the bundler, and vitest.
**Trap:** Using `@fastify/autoload` breaks under vitest and tsx watch mode.

## ZodError detection uses shape-matching, not just instanceof

**What:** The error handler in `app.ts` checks `name + issues` array shape, not only `instanceof z.ZodError`.
**Why:** Duplicate Zod module instances across `shared/` and `api` packages break `instanceof`.
**Trap:** Removing the shape-match fallback makes service-level `.parse()` errors return 500 instead of 422.

## Container async vs sync getters

**What:** `llm()`, `github()`, `embedder()` are async methods; `git`, `codeIndex`, `repoIntel` are sync getters.
**Why:** Async ones fetch secrets from `SecretsProvider` on first call and cache the result. Sync ones don't need secrets.
**Trap:** Calling `await container.git` compiles but does nothing useful — it's already sync.

## SSE buffer replay for late subscribers

**What:** `RunBus` keeps an in-memory event buffer per run. Late SSE subscribers replay the full log before switching to live.
**Why:** A client that connects mid-run (or reconnects after a drop) must see the complete history, not just future events.
**Trap:** Clearing the buffer on completion too eagerly causes late subscribers to see an empty log. The buffer is kept briefly after `complete()`.

## Rate limit disabled in test

**What:** Global rate limit (`120/min`) is skipped when `NODE_ENV=test`.
**Why:** Integration tests use `app.inject()` and would hit the limit immediately.
**Trap:** Per-route rate limit overrides still exist on expensive endpoints — they are not disabled in test.
