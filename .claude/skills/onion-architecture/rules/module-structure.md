# Module Structure

How to organize a feature module's folder layout. Flat vs full onion -- and when to use each.

## Current Flat Structure

Most DevDigest modules use a flat structure:

```
modules/repos/
  routes.ts        — Presentation (Fastify plugin)
  service.ts       — Application (use cases, orchestration)
  repository.ts    — Infrastructure (Drizzle queries)
  helpers.ts       — Domain (pure transforms)
  constants.ts     — Domain (literals)
```

This maps naturally to onion layers. It works well for modules with moderate complexity.

## Full Onion Structure

For complex modules with rich domain logic, multiple adapters, or significant test surface:

```
modules/<name>/
  domain/
    entities.ts        — Domain entities, value objects
    ports.ts           — Repository + service interfaces
    services.ts        — Domain services (pure business rules)
    errors.ts          — Domain-specific errors
  application/
    service.ts         — Use cases / orchestration
    dtos.ts            — Data transfer objects
    mappers.ts         — Domain <-> DTO mappers
  infrastructure/
    repository.ts      — Drizzle implementation of domain ports
    mappers.ts         — DB row <-> domain entity mappers
  presentation/
    routes.ts          — Fastify plugin
    schemas.ts         — Zod request/response schemas
  index.ts             — Public API of the module (optional)
```

## When to Use Full Onion

Use full onion when the module has:

| Criterion | Example |
|-----------|---------|
| Complex business rules | State transitions, invariant enforcement, multi-step workflows |
| Multiple external dependencies | LLM + GitHub + Git + DB |
| Significant testing needs | Domain logic worth unit-testing in isolation |
| Long-term maintenance | Core feature that will grow over time |

**Candidates in DevDigest:**
- `reviews/` -- complex orchestration (LLM calls, grounding, findings lifecycle, SSE streaming)
- `repo-intel/` -- already has domain-like separation via `types.ts` facade + `pipeline/` subdirectory

## When Flat Is Fine

Use flat structure for:

| Criterion | Example |
|-----------|---------|
| Simple CRUD | settings, workspace |
| Thin wrappers | polling (delegates to service) |
| No domain logic | Data passthrough with validation |
| Small module | < 5 files, unlikely to grow |

**Current flat modules that should stay flat:**
- `settings/` -- simple key/value management
- `workspace/` -- basic CRUD
- `polling/` -- scheduling wrapper

## Incremental Migration

Don't rewrite a module to full onion in one go. Migrate incrementally:

### Step 1: Extract domain types
```
modules/repos/
  domain/
    entities.ts      — Move Repo type from repository.ts here (drop Drizzle dependency)
  routes.ts
  service.ts
  repository.ts      — Now imports from domain/entities.ts
  helpers.ts          — Consider moving into domain/
  constants.ts        — Consider moving into domain/
```

### Step 2: Define port interfaces
```
modules/repos/
  domain/
    entities.ts
    ports.ts          — RepoRepository interface (returns domain entities)
  ...
```

### Step 3: Add infrastructure mappers
```
modules/repos/
  domain/
    entities.ts
    ports.ts
  repository.ts       — Now implements domain port, has row-to-entity mapper
  ...
```

### Step 4: Reorganize into subdirectories
```
modules/repos/
  domain/
    entities.ts
    ports.ts
  application/
    service.ts
  infrastructure/
    repository.ts
    mappers.ts
  presentation/
    routes.ts
```

Each step is a standalone, reviewable PR. No big-bang refactor needed.

## Module Registry

Regardless of internal structure, every module registers the same way:

```typescript
// modules/index.ts
import reposRoutes from './repos/routes.js';       // flat module
import reviewsRoutes from './reviews/routes.js';   // could be full onion

export const modules: FastifyPluginAsync[] = [
  reposRoutes,
  reviewsRoutes,
  // ...
];
```

If using full onion, the route file moves to `presentation/routes.ts`, so update the import path:

```typescript
import reviewsRoutes from './reviews/presentation/routes.js';
```

## Shared Module Utilities

Cross-module shared code lives in `modules/_shared/`:

```
modules/_shared/
  context.ts       — getContext() for workspace/user resolution
  schemas.ts       — Common Zod schemas (IdParams)
```

This is presentation-layer shared code. If domain-level sharing is needed between modules, use `@devdigest/shared` (vendor/shared/) for contracts and interfaces.

## Rules

1. **Start flat, graduate to onion when pain emerges.** Don't over-engineer a module that has three endpoints and no business logic.
2. **Each migration step is a standalone PR.** Don't mix onion refactoring with feature work.
3. **Module internals are private.** Other modules access through Container (for repos) or shared contracts (for types). Never import `modules/repos/repository.ts` from `modules/reviews/`.
4. **One route plugin per module.** Internal layering is the module's concern; the registry sees one Fastify plugin.
