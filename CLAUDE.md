# DevDigest

AI-powered local-first PR review studio.

## How to search for answers

Always check the relevant package's curated sources before giving user an answer:
1. `<package>/CLAUDE.md` — rules, map, conventions, gotchas
2. `<package>/docs/` — detailed documentation
3. `<package>/specs/` — behavioral specifications
4. `<package>/INSIGHTS.md` — non-obvious decisions and traps
5. `<package>/README.md` — narrative overview with diagrams

## Tech stack

Fastify 5, Next.js 15 (App Router), React 19, Drizzle ORM, PostgreSQL 16 + pgvector,
TanStack Query 5, Tailwind 4, Zod, Vitest. Node 22, ESM throughout.

## Packages (no workspace — separate lockfiles)

| Folder | Name | Port | Package manager |
|--------|------|------|-----------------|
| server/ | @devdigest/api | 3001 | pnpm |
| client/ | @devdigest/web | 3000 | pnpm |
| reviewer-core/ | @devdigest/reviewer-core | — | npm |
| e2e/ | @devdigest/e2e | — | npm |

Cross-package sharing via tsconfig path aliases, not published packages:
- `@devdigest/shared` → `server/src/vendor/shared`
- `@devdigest/reviewer-core` → `reviewer-core/src`

## Commands

```sh
./scripts/dev.sh                # full stack: docker → migrate → seed → server + client
./scripts/dev.sh --db-only      # Postgres only
cd server && pnpm db:migrate    # apply migrations (NOT applied on boot)
cd server && pnpm db:seed       # idempotent demo data
cd server && pnpm test          # unit + integration
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'  # unit only (no Docker)
cd server && pnpm exec vitest run .it.test                     # integration only (needs Docker)
cd client && pnpm test          # component tests (jsdom, no API)
cd reviewer-core && npm test    # engine tests (no keys, no network)
./scripts/e2e.sh                # hermetic e2e on isolated ports
```

## Conventions

- Integration tests use `*.it.test.ts` suffix — this drives the unit/integration split.
- Modules are registered statically in `server/src/modules/index.ts`, not autoloaded.
- Secrets live in `~/.devdigest/secrets.json` (mode 0600), never in env config, git, or DB.
  `process.env` is a fallback. All access through `SecretsProvider`.
- DB schema contains tables for all features; unused ones sit empty.
- reviewer-core is consumed as raw TypeScript source — it never emits JS.

## Gotchas

- Migrations are NOT applied on boot. Forgetting `pnpm db:migrate` causes
  "relation does not exist" errors.
- Duplicate Zod instances across shared/api break `instanceof z.ZodError`.
  The error handler uses shape-matching as a fallback — don't remove it.
- `server/clones/` is runtime data (git-ignored). Never commit or collect in tests.

## Do not touch

- `server/src/vendor/shared/` — extend with new files only, never edit existing contracts.
- `INJECTION_GUARD` in `reviewer-core/src/prompt.ts` — the single prompt-injection
  defense; appended to every agent prompt automatically.
- Grounding gate in `reviewer-core/src/grounding.ts` — mandatory mechanical filter;
  score is recomputed from grounded findings, model's self-reported score is ignored.

## Testing

Strategy in TESTING.md. Five CI workflows, path-filtered per package.
Typological coverage (not exhaustive). Mocks in `server/src/adapters/mocks.ts`.
