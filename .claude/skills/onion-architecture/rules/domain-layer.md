# Domain Layer

The innermost layer. Contains core business logic with zero external dependencies.

> Reference: [Jeffrey Palermo -- The Onion Architecture](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) -- "The application is built around an independent object model."

## What Lives Here

- **Domain entities** -- objects with identity and behavior (not just data)
- **Value objects** -- immutable types that encode domain rules
- **Repository interfaces (ports)** -- what data access the domain needs (not how)
- **Domain services** -- stateless logic spanning multiple entities
- **Domain errors** -- business rule violations
- **Constants** -- domain literals and enumerations

## Domain Entities vs Drizzle Row Types

Currently the project uses Drizzle row types as domain models:

```typescript
// CURRENT (infrastructure leaks into domain)
// repository.ts
export type RepoRow = typeof t.repos.$inferSelect;

// service.ts -- works with RepoRow directly
const existing = await this.repo.findByFullName(workspaceId, fullName);
```

In full onion, define independent domain entity types:

```typescript
// ONION -- domain/entities.ts (no Drizzle imports)
export interface Repo {
  readonly id: string;
  readonly workspaceId: string;
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly clonePath: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
}

// infrastructure/repository.ts -- maps DB rows to domain entities
import type { Repo } from '../domain/entities.js';

function toEntity(row: typeof t.repos.$inferSelect): Repo {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    owner: row.owner,
    name: row.name,
    fullName: row.fullName,
    clonePath: row.clonePath,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}
```

This isolates the service from schema changes (column renames, type changes, new nullable columns).

## Value Objects

Immutable types that validate on construction and encapsulate domain rules:

```typescript
// domain/value-objects.ts
export class RepoUrl {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly url: string;

  constructor(url: string) {
    const match = url.match(
      /(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/.]+)/,
    );
    if (!match) throw new InvalidRepoUrlError(url);
    this.owner = match[1];
    this.name = match[2];
    this.fullName = `${this.owner}/${this.name}`;
    this.url = `https://github.com/${this.fullName}`;
  }
}
```

Compare to the current `parseRepoUrl()` in `helpers.ts` -- same logic, but a value object guarantees that any `RepoUrl` instance is already validated. You cannot have an invalid `RepoUrl`.

## Rich Entities vs Anemic Domain

Entities should encapsulate behavior and enforce invariants, not just hold data:

```typescript
// ANEMIC (anti-pattern) -- entity is a data bag, logic in service
class ReviewService {
  accept(review: Review) {
    if (review.status === 'dismissed') throw new Error('Cannot accept dismissed');
    review.status = 'accepted';  // direct mutation
    review.acceptedAt = new Date();
  }
}

// RICH (preferred) -- entity encapsulates state transitions
interface Review {
  accept(): Review;  // returns new state, enforces invariants
  dismiss(reason: string): Review;
}
```

**When to use rich entities:** When there are state transitions, invariants to enforce, or business rules that should not be duplicated across services.

**When anemic is acceptable:** Simple CRUD entities with no business rules beyond validation (settings, workspace metadata). Don't force behavior onto data that is genuinely just data.

## Repository Interfaces (Ports)

Define in the domain layer what the module needs, not how it queries:

```typescript
// domain/ports.ts
import type { Repo } from './entities.js';

export interface RepoRepository {
  findByFullName(workspaceId: string, fullName: string): Promise<Repo | undefined>;
  list(workspaceId: string): Promise<Repo[]>;
  getById(workspaceId: string, id: string): Promise<Repo | undefined>;
  insert(values: InsertRepo): Promise<Repo>;
  remove(workspaceId: string, id: string): Promise<boolean>;
}
```

The interface returns domain entities (`Repo`), not DB rows. The infrastructure layer implements this with Drizzle and maps rows to entities.

## Domain Services

Stateless services for logic spanning multiple entities or requiring external data through ports:

```typescript
// domain/services.ts
export function computeReviewScore(findings: Finding[]): number {
  // Pure business logic -- no DB, no HTTP, no framework
  const grounded = findings.filter((f) => f.isGrounded);
  return grounded.reduce((sum, f) => sum + f.severity, 0) / grounded.length;
}
```

The grounding gate in `reviewer-core/src/grounding.ts` is a good example of domain-pure logic that belongs in this layer -- it's a mechanical filter with no infrastructure dependencies.

## Existing Proto-Domain in DevDigest

| File | Domain role | Notes |
|------|-------------|-------|
| `helpers.ts` | Pure transforms | `parseRepoUrl`, `toRepoDto`, `findingRowToDto` |
| `constants.ts` | Domain literals | `CLONE_JOB_KIND`, `CLONE_DEPTH`, `GITHUB_TOKEN_SECRET` |
| `types.ts` | Facade interfaces | `RepoIntel` interface in `modules/repo-intel/types.ts` |
| `@devdigest/shared` | Port interfaces | `GitHubClient`, `LLMProvider`, `GitClient`, `SecretsProvider` |
| `platform/errors.ts` | Domain errors | `AppError`, `NotFoundError`, `ConfigError` |

These files are already domain-like. Full onion adoption means consolidating them into a `domain/` subdirectory within each module and ensuring they have zero infrastructure imports.
