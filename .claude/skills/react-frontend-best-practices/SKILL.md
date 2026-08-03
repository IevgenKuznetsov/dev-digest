---
name: react-frontend-best-practices
description: "Frontend architectural organization for React / Next.js App Router / TanStack Query projects. Covers WHERE code belongs: component location, constants placement, helper extraction, business logic boundaries, module structure. Use when deciding where to place new files, when to promote/extract code, or how to organize a feature. Complements react-best-practices (HOW to write) and next-best-practices (framework features)."
---

# React Frontend Architecture

Where code belongs in a React / Next.js App Router / TanStack Query codebase. For HOW to write components, hooks, and state — see `react-best-practices`. For Next.js framework features (RSC, file conventions, data patterns) — see `next-best-practices`. For code examples — see [examples.md](examples.md). For sources — see [references.md](references.md).

## Severity Levels

- **CRITICAL** — Wrong placement causes coupling, circular deps, or unmaintainable code
- **HIGH** — Wrong placement causes friction, duplication, or scaling problems
- **MEDIUM** — Hurts discoverability or developer experience

---

## 1. Component Location & Organization

### Three-Tier Hierarchy (CRITICAL)

Every component lives in exactly one of three locations:

| Location | Scope | When to use |
|----------|-------|-------------|
| `app/<route>/_components/<Name>/` | Page-specific | Default for new components — used by one page only |
| `components/<Feature>/` | Shared | Used by 2+ pages |
| `vendor/ui/` | Design system | Primitives (Button, Card, Modal) — read-only |

Never create a fourth location. If you're unsure, start in `_components/`.

### Promotion Trigger: Second Consumer (HIGH)

A component starts in `_components/`. Move it to `components/` only when a second page actually needs it. Never promote preemptively — "prefer duplication over the wrong abstraction" (Sandi Metz via Kent C. Dodds AHA Programming). Wait until the pattern is undeniable, typically by the third occurrence.

### Standard Component Folder (HIGH)

Every component gets its own folder with a predictable set of files:

```
ComponentName/
├── ComponentName.tsx       # The component ("use client" if needed)
├── index.ts                # Barrel: export { ComponentName } from "./ComponentName"
├── constants.ts            # (optional) Component-scoped constants
├── helpers.ts              # (optional) Pure functions for this component
├── styles.ts               # (optional) CSSProperties objects using CSS vars
├── ComponentName.test.tsx  # (optional) Vitest + React Testing Library
└── _components/            # (optional) Nested sub-components
```

Only include files that have content. An empty `helpers.ts` is noise.

### Route-Local Folders (HIGH)

Use `_components/` (underscore prefix) for page-specific component folders. This is the Next.js App Router convention for private folders — the underscore excludes the folder from routing. See `next-best-practices` file-conventions for details.

### Nested Sub-Components (MEDIUM)

When a page-specific component grows its own sub-components, nest them inside the parent:

```
RunTraceDrawer/
├── RunTraceDrawer.tsx
├── index.ts
└── _components/
    ├── TraceBody/
    ├── PromptBlock/
    └── ToolCallRow/
```

This preserves ownership — `TraceBody` belongs to `RunTraceDrawer`, not to the page.

### Barrel Export Convention (MEDIUM)

Each component folder's `index.ts` exports the component by name:

```ts
export { ComponentName } from "./ComponentName";
```

This allows clean imports (`from "@/components/diff-viewer"`) while keeping the internal file structure hidden.

---

## 2. Constants

### No Magic Values (CRITICAL)

Extract all literal numbers, strings, and configuration values to named constants. Every magic value in a component body is a readability and maintainability debt.

```ts
// BAD
if (findings.length > 3) { ... }
const interval = setInterval(refetch, 4000);

// GOOD
const MAX_VISIBLE_FINDINGS = 3;
const ACTIVE_RUN_POLL_MS = 4000;
```

### Narrowest Scope (HIGH)

Place constants at the narrowest scope that covers all consumers:

| Consumers | Location |
|-----------|----------|
| One component | `ComponentFolder/constants.ts` |
| Multiple components in one feature/page | Page-level or feature-level `constants.ts` |
| Multiple pages or `lib/` code | `lib/<domain>.ts` (e.g., `lib/feature-models.ts`) |

Never put a constant in `lib/` if only one component uses it.

### Config vs Display Constants (HIGH)

Separate behavioral constants from visual constants — they change for different reasons:

- **Config constants** affect behavior: timeouts, polling intervals, thresholds, limits
  ```ts
  export const ACTIVE_RUN_POLL_MS = 4_000;
  export const SKELETON_ROWS = 8;
  ```

- **Display constants** affect presentation: color maps, label maps, sort options
  ```ts
  export const MODEL_COLOR: Record<string, string> = { "gpt-4o": "#10b981" };
  export const COLUMN_KEYS = ["number", "title", "size", "status"];
  ```

### `as const` Over Enums (MEDIUM)

Prefer `as const` objects over TypeScript `enum`. Enums generate runtime code, have numeric reverse-mapping quirks, and tree-shake poorly:

```ts
// GOOD
export const Severity = { CRITICAL: "CRITICAL", WARNING: "WARNING", SUGGESTION: "SUGGESTION" } as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

// AVOID
enum Severity { CRITICAL = "CRITICAL", WARNING = "WARNING", SUGGESTION = "SUGGESTION" }
```

---

## 3. Helpers & Utils

### Helpers Are Pure (HIGH)

A helper function takes input, returns output, has no side effects. It does not call hooks, read context, access the DOM, or fire network requests. If it needs any of those — it's a hook, not a helper.

### Colocate First, Extract on Reuse (HIGH)

Place a helper in `ComponentFolder/helpers.ts` when only that component uses it. Move it outward only when a second consumer appears:

```
1 consumer  → ComponentFolder/helpers.ts
2+ in same feature → feature-level helpers.ts
2+ across features → lib/<domain>.ts
```

This mirrors the component promotion rule and follows the colocation principle (Kent C. Dodds).

### Extraction Criteria (MEDIUM)

Extract logic into a helper when it has clear inputs/outputs and non-trivial branching — enough to warrant a unit test in isolation. A one-line string concatenation can stay inline. A multi-step data transformation with conditionals should be extracted.

### Helper vs Hook Decision (MEDIUM)

```
Does the logic need React state, effects, context, or lifecycle?
├── Yes → Custom hook (useXxx)
└── No  → Pure helper function
```

Keyboard event listeners → hook (needs `useEffect`). Badge color from severity string → helper (pure mapping).

### Dependency Direction for Utils (HIGH)

Files in `lib/` are shared utilities — they must never import from `components/` or `app/`. The dependency arrow always points inward:

```
app/ → components/ → lib/ → vendor/
```

A `lib/github-urls.ts` that imports from `app/repos/` is a dependency direction violation.

---

## 4. Business Logic Boundaries

### TanStack Query Hooks = Business Logic Layer (CRITICAL)

`lib/hooks/` files organized by domain (`core.ts`, `reviews.ts`, `agents.ts`, `trace.ts`) encapsulate all server-state management: data fetching, cache keys, polling intervals, optimistic updates, and mutation side-effects. Components never call `api.ts` directly — they call hooks.

This aligns with TanStack Query's design: it manages server-state, replacing the boilerplate of loading/error states, cache wiring, and request deduplication. What remains as client state (filters, focus index, modal open/close) stays in component-local `useState`.

### Pages Are Orchestrators (CRITICAL)

Page files (`page.tsx`) wire together hooks and child components. They should contain:
- Route param resolution
- Hook calls for data
- Loading/error/empty state handling
- Child component composition

They should NOT contain:
- Business logic (filtering, sorting, scoring)
- Complex UI rendering (delegated to `_components/`)
- Direct API calls

A page with 100+ lines of orchestration is fine. A page with 10 lines of business logic is not.

### Data-Fetching vs UI Hooks (HIGH)

| Hook type | Location | Examples |
|-----------|----------|---------|
| Data-fetching | `lib/hooks/<domain>.ts` | `usePulls()`, `useRunReview()`, `useAgents()` |
| UI-behavior | Colocated with consumer | `useGlobalShortcuts()`, `useScrollPosition()` |

Data-fetching hooks are shared infrastructure. UI-behavior hooks are implementation details of specific components and live in `ComponentFolder/hooks/` or `app-shell/hooks/`.

### Domain vs Presentation Logic (HIGH)

- **Domain logic**: "which findings are lethal trifecta?", "is this run still active?" → belongs in a hook or `helpers.ts`
- **Presentation logic**: "how wide is this column?", "which icon for this status?" → belongs in the component or `styles.ts`

If domain logic appears in a component's render body, extract it to a helper or hook.

### Mutation Side-Effects (MEDIUM)

Cache invalidation, optimistic updates, and success/error toasts belong in the mutation hook's `onSuccess`/`onError` callbacks — not in the component that triggers the mutation. The component should only call `mutation.mutate(data)`.

> **Note:** State colocation rules and Context-as-infrastructure guidance are covered in `react-best-practices` — not repeated here.

---

## 5. Module Boundaries

### Dependency Direction (CRITICAL)

The dependency graph must be acyclic and flow in one direction:

```
app/  →  components/  →  lib/  →  vendor/
```

- `vendor/` depends on nothing (read-only contracts)
- `lib/` depends only on `vendor/`
- `components/` depends on `lib/` and `vendor/`
- `app/` depends on all three

No file in `lib/` may import from `components/` or `app/`. No file in `components/` may import from `app/`. Violations create circular dependencies and make code impossible to test in isolation.

This maps to Bulletproof React's unidirectional flow (`shared → features → app`) and Feature-Sliced Design's strict downward dependency rule.

### Colocation Principle (HIGH)

"Place code as close to where it's relevant as possible" (Kent C. Dodds). This is the organizing principle behind:
- Per-component `constants.ts`, `helpers.ts`, `styles.ts`
- Page-specific `_components/` folders
- Domain-organized hooks in `lib/hooks/`

Move code farther from its consumer only when sharing forces it. Each move increases the blast radius of changes.

### Barrel Exports: Boundaries Only (HIGH)

Barrel files (`index.ts`) are appropriate at **module boundaries**:
- Component folders: `ComponentName/index.ts`
- Hook modules: `lib/hooks/index.ts`

Barrels are NOT appropriate for:
- Deep re-exports that obscure the actual source (`lib/index.ts` re-exporting everything)
- Aggregating the entire app into one import
- Creating chains of barrels that hurt tree-shaking and slow builds

Bulletproof React recommends direct imports over barrels for this reason.

### Hybrid Organization (MEDIUM)

The codebase uses a deliberate hybrid of feature-based and layer-based organization:

- **Feature-based**: Routes (`app/agents/`, `app/repos/[repoId]/pulls/`), page components (`_components/FindingCard/`)
- **Layer-based**: Shared utilities (`lib/hooks/`, `lib/api.ts`), vendor packages (`vendor/ui/`, `vendor/shared/`)

This is intentional. Pure feature-slicing (Feature-Sliced Design) adds unnecessary indirection at this scale. Pure layer-based organization scatters related code. The hybrid colocates what changes together while sharing what's truly common.

### Vendor Boundary (MEDIUM)

`vendor/shared/` and `vendor/ui/` are read-only copies of upstream packages. When extending:
- Add new files — never edit existing ones
- Import via aliases (`@devdigest/ui`, `@devdigest/shared`) — never reach into subfolders directly
- If a runtime import from vendor breaks the bundler, create a local re-export in `lib/` (as `lib/feature-models.ts` does)
