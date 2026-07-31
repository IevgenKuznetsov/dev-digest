# Insights — @devdigest/web

Non-obvious decisions, architectural traps, and things that look wrong but aren't.

## Module-level notify bypasses React tree

**What:** `toast.tsx` exports a `notify` object that can surface errors without being inside a React component.
**Why:** TanStack Query's global `onError` callback runs outside the component tree. A hook-based toast wouldn't work there.
**Trap:** Replacing `notify` with a `useToast()` hook breaks global error surfacing — mutations/queries silently swallow errors.

## Content-Type header is conditionally set

**What:** `api.ts` only sends `content-type: application/json` when `init.body` is present.
**Why:** Fastify rejects body-less POST/PUT with "Body cannot be empty when content-type is application/json".
**Trap:** Adding the header unconditionally breaks tour generate, refresh, reindex, and any other body-less POST.

## Theme no-flash script in head

**What:** An inline `<script>` in `<head>` reads theme from localStorage and sets `data-theme` on `<html>` before React hydrates.
**Why:** Without it, dark-mode users see a white flash on every page load.
**Trap:** Moving this to a React component or `useEffect` reintroduces the flash — it must run before first paint.

## Active repo resolution order

**What:** `RepoProvider` resolves the active repo from: URL pathname (regex) → localStorage → first repo from API.
**Why:** URL-first gives bookmarkable repo switching and correct back-button behavior.
**Trap:** Changing the priority (e.g., localStorage-first) breaks deep links and browser history navigation.

## Adaptive polling intervals

**What:** `refetchInterval` is a function, not a constant — it returns different values based on query state.
**Why:** Active runs poll at 4s (needs responsiveness), PR list at 60s (stale is fine), and polling self-clears when runs complete.
**Trap:** Replacing the function with a static interval either wastes bandwidth (always 4s) or feels sluggish (always 60s).
