# Anti-Patterns

Common onion architecture violations with detection heuristics and fixes.

> Reference: [Allegro Tech Blog -- Onion Architecture](https://blog.allegro.tech/2023/02/onion-architecture.html) -- practical anti-patterns and enforcement strategies.

## 1. Leaking Infrastructure into Domain

**Symptom:** Domain files import from infrastructure packages.

```typescript
// BAD -- domain/entities.ts imports Drizzle
import { sql } from 'drizzle-orm';

export function isStale(repo: Repo): boolean {
  // Using Drizzle's sql helper in domain logic
}
```

**Detection:** Grep domain files for infrastructure imports:
```bash
grep -r "from 'drizzle-orm'" modules/*/domain/
grep -r "from 'fastify'" modules/*/domain/
grep -r "from '../../adapters/" modules/*/domain/
```

**Fix:** Domain code uses only pure TypeScript. Move infrastructure-dependent logic to the infrastructure or application layer.

## 2. Anemic Domain Model

**Symptom:** Entities are data bags with no behavior. All business logic lives in services.

```typescript
// BAD -- service does everything, entity is just data
class ReviewService {
  accept(review: ReviewRow) {
    if (review.status === 'dismissed') throw new Error('...');
    review.status = 'accepted';
    review.acceptedAt = new Date();
    await this.repo.update(review);
  }
}
```

**Detection:** Check if entities have methods beyond getters/setters. If all `if` statements checking entity state are in services, the domain is anemic.

**Fix:** Move state transition logic into the entity:
```typescript
// GOOD -- entity enforces its own invariants
class Review {
  accept(): Review {
    if (this.status === 'dismissed') throw new CannotAcceptDismissedError();
    return new Review({ ...this, status: 'accepted', acceptedAt: new Date() });
  }
}
```

**When anemic is OK:** Simple CRUD entities with no business rules (settings, workspace metadata).

## 3. Fat Controllers / Fat Routes

**Symptom:** Route handlers contain business logic, conditional branching, or data transformation beyond formatting.

```typescript
// BAD -- business logic in route
app.post('/repos', async (req, reply) => {
  const { url } = req.body;
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);  // parsing in route!
  if (!match) { reply.status(400); return { error: 'Invalid URL' }; }
  const [row] = await db.select().from(t.repos).where(...);  // direct DB in route!
  if (row) { return toDto(row); }
  // ... more logic
});
```

**Detection:** Route files with more than ~10 lines per handler (excluding schema setup). Any `import` from `drizzle-orm` or direct DB access in routes.

**Fix:** Extract all logic to the service. Routes should be 3-5 lines: validate, context, delegate, respond.

## 4. ORM Types as Domain Entities

**Symptom:** Using `typeof t.repos.$inferSelect` as the domain model throughout the codebase.

```typescript
// BAD -- Drizzle row type used as domain entity
export type RepoRow = typeof t.repos.$inferSelect;

// service.ts works directly with RepoRow
async add(workspaceId: string, url: string): Promise<RepoRow> { ... }
```

**Detection:** Search for `$inferSelect` or `$inferInsert` used outside of repository files.

**Fix:** Define independent domain entity types. Add a mapper in the repository to convert rows to entities. See [domain-layer.md](domain-layer.md) for details.

**Pragmatic note:** This is the most common violation in DevDigest. It's acceptable for simple modules but should be fixed when domain entities need behavior or when schema changes would cascade through the entire codebase.

## 5. Reverse Dependencies

**Symptom:** An inner layer imports from an outer layer.

```typescript
// BAD -- domain imports from infrastructure
// domain/services.ts
import { RepoRepository } from '../infrastructure/repository.js';  // concrete!

// BAD -- infrastructure imports from presentation
// repository.ts
import type { FastifyRequest } from 'fastify';  // why?
```

**Detection:** Check import paths in each layer:
```bash
# Domain should not import from application, infrastructure, or presentation
grep -r "from '.*infrastructure" modules/*/domain/
grep -r "from '.*application" modules/*/domain/

# Infrastructure should not import from presentation
grep -r "from 'fastify'" modules/*/repository.ts
```

**Fix:** Apply the dependency rule. Inner layers define interfaces; outer layers implement them. See [dependency-rule.md](dependency-rule.md).

## 6. Container as Service Locator

**Symptom:** Passing the entire `Container` deep into domain code, allowing any layer to reach any dependency.

```typescript
// BAD -- domain service receives whole Container
class ReviewDomainService {
  constructor(private container: Container) {}

  computeScore(findings: Finding[]): number {
    // Could call container.github(), container.llm() -- no boundary enforcement
  }
}
```

**Detection:** `Container` type appearing in domain or pure-logic files.

**Fix:** Inject specific interfaces via constructor parameters:
```typescript
// GOOD -- receives only what it needs
class ReviewDomainService {
  constructor(private grounding: GroundingService) {}
}
```

**Pragmatic note:** Services currently take `Container`, which is acceptable at the application layer. The violation is when Container reaches into domain services or pure-logic code.

## 7. Cross-Module Coupling

**Symptom:** One module imports directly from another module's internals.

```typescript
// BAD -- repos module imports from repo-intel internals
import { INDEX_JOB_KIND, REFRESH_JOB_KIND } from '../repo-intel/constants.js';
```

**Detection:** Look for imports that cross module boundaries:
```bash
grep -r "from '\.\./[a-z]" modules/*/service.ts  # service importing from sibling module
```

**Fix options:**
1. Move shared constants to `modules/_shared/` or `@devdigest/shared`
2. Use event/message contracts instead of direct imports
3. Expose through Container (as done with `agentsRepo`, `reviewRepo`)

## 8. Pass-Through Layers

**Symptom:** A layer exists but just delegates to the next layer without adding value.

```typescript
// BAD -- service method is pure pass-through
class SettingsService {
  async get(workspaceId: string) {
    return this.repo.get(workspaceId);  // adds nothing
  }
  async update(workspaceId: string, data: Settings) {
    return this.repo.update(workspaceId, data);  // adds nothing
  }
}
```

**Detection:** Service methods that are single-line delegations to repository methods.

**Fix:** For simple CRUD, it's OK to keep a thin service layer for consistency and future extensibility. But don't add a domain layer on top if it would also be pass-through. See [module-structure.md](module-structure.md) for when flat structure is appropriate.

## Quick Checklist for PR Reviews

- [ ] No `drizzle-orm` or `fastify` imports in domain files
- [ ] No `$inferSelect` types used outside of repository files
- [ ] Routes are thin (validate, context, delegate, respond)
- [ ] Services throw domain errors, not HTTP errors
- [ ] No cross-module internal imports
- [ ] Container not passed into domain services
- [ ] Repository methods return domain entities (for onion modules)
- [ ] New interfaces defined in inner layers, implementations in outer layers
