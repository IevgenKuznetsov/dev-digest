# @devdigest/api

## Tech stack

Fastify 5, Drizzle ORM, PostgreSQL 16 + pgvector, Zod (validation + type provider),
p-queue (background jobs), simple-git, Octokit, ast-grep, dependency-cruiser, ripgrep.

## Commands

```sh
pnpm dev              # API on :3001
pnpm test             # unit + integration
pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit only, no Docker
pnpm exec vitest run .it.test                       # integration only, needs Docker
pnpm typecheck
pnpm db:migrate       # NOT applied on boot
pnpm db:seed          # idempotent demo data
pnpm db:generate      # generate migration after schema change
```

## Conventions

- Each module is a Fastify plugin in `modules/<name>/routes.ts`.
  To add a module: create routes.ts, add one import + one entry in `modules/index.ts`.
- Every route calls `getContext(container, req)` first — resolves workspace + user.
- `*.it.test.ts` = integration test (needs Docker/Postgres). Everything else is unit.
- Adapters implement interfaces from `@devdigest/shared`, injected via Container.
- SSE runs buffer all events in memory; late subscribers get full replay.

## Gotchas

- On boot, stale "running" agent_runs are reaped (marked failed). This is AWAITED
  before accepting requests — making it async creates a race with new runs.
- `llm()`, `github()`, `embedder()` on Container are async — they fetch secrets on
  first call. Sync getters (git, codeIndex) don't need secrets.
- `EMBEDDINGS_ENABLED=false` (default) means zero OpenAI calls. `embedder()` throws
  immediately — callers must catch and degrade.
- Global rate limit is disabled under `NODE_ENV=test`. Per-route overrides exist
  on expensive endpoints.

## Do not touch

- `vendor/shared/` — add new contract files, never edit existing ones.
- `adapters/mocks.ts` — shared test mocks. Change interface → update mock.
- The error handler's ZodError shape-matching fallback in `app.ts` — needed because
  `instanceof` fails across duplicate Zod module instances.
