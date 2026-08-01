# @devdigest/web

## Curated sources (search here first)

- [docs/](docs/) — detailed documentation
- [specs/](specs/) — behavioral specifications
- [INSIGHTS.md](INSIGHTS.md) — non-obvious decisions and traps
- [README.md](README.md) — narrative overview (UI route map, testing)

## Tech stack

Next.js 15 (App Router), React 19, TanStack Query 5, Tailwind 4, next-intl,
Recharts, Mermaid, react-markdown, Lucide icons. Vitest + Testing Library for tests.

## Commands

```sh
pnpm dev          # web on :3000
pnpm test         # component tests (jsdom, no API needed)
pnpm typecheck
pnpm build
```

## Map

```
src/
  app/                   Next.js App Router pages (thin — just import view component)
    repos/[repoId]/pulls/          PR list
    repos/[repoId]/pulls/[number]/ PR detail (Overview, Agent runs, Files changed tabs)
    agents/                        agent list + editor
    onboarding/                    add first repo
    settings/                      API keys, models
  components/
    app-shell/           header, nav, breadcrumbs
    <Feature>/           colocated: Component.tsx, .test.tsx, helpers.ts, styles.ts, index.ts
  lib/
    api.ts               typed fetch wrapper → NEXT_PUBLIC_API_BASE (default localhost:3001)
    hooks/               TanStack Query hooks by domain: core, reviews, agents, trace
    providers/           RepoProvider, ThemeProvider, ToastProvider
  vendor/
    ui/                  @devdigest/ui — shared UI primitives
    shared/              @devdigest/shared — Zod contracts (read-only copy)
```

## Conventions

- Pages are thin entry points; all logic lives in colocated `_components/<Name>/` folders.
- Styles use inline CSSProperties objects with CSS variables (`var(--text-primary)`),
  not a CSS-in-JS library.
- `notify` object in `toast.tsx` works outside the React tree — used by Query's
  global error handler. Don't replace with a hook.
- Active repo resolved from: URL pathname → localStorage → first repo from API.
- Polling: active runs 4s, PR list 60s + refocus, run history 4s while any running.

## Gotchas

- `api.ts` only sends `content-type: application/json` when body is present.
  Adding it unconditionally breaks body-less POST/PUT (Fastify rejects empty JSON body).
- Theme uses a no-flash inline `<script>` in `<head>` that reads localStorage
  before React hydrates. Don't remove or move it to a component.

## Do not touch

- `vendor/shared/` and `vendor/ui/` — vendored from server, not locally editable.
