# @devdigest/web

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
