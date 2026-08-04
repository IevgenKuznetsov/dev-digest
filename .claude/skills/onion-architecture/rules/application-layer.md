# Application Layer

The orchestration layer. Coordinates domain objects and repository ports to accomplish user goals.

## What Lives Here

- **Use cases** -- each public method on a service class
- **Application services** -- classes that orchestrate use cases
- **DTOs** -- data transfer objects for crossing layer boundaries
- **Mappers** -- convert between domain entities and DTOs
- **Error translation** -- throw domain errors, not HTTP errors

## Use Cases

Each public method on a service is a use case. It follows a consistent pattern:

```typescript
// service.ts (Application layer)
export class RepoService {
  constructor(
    private repoPort: RepoRepository,  // domain port (interface)
    private jobs: JobRunner,
    private secrets: SecretsProvider,
    private git: GitClient,
  ) {}

  async add(workspaceId: string, userId: string, url: string): Promise<{ repo: RepoDto; created: boolean }> {
    // 1. Domain logic -- validate and parse
    const repoUrl = new RepoUrl(url);  // value object validates

    // 2. Check via repository port
    const existing = await this.repoPort.findByFullName(workspaceId, repoUrl.fullName);
    if (existing) return { repo: toRepoDto(existing), created: false };

    // 3. Persist via repository port
    const repo = await this.repoPort.insert({
      workspaceId, owner: repoUrl.owner, name: repoUrl.name,
      fullName: repoUrl.fullName, createdBy: userId,
    });

    // 4. Side effects
    await this.jobs.enqueue(workspaceId, CLONE_JOB_KIND, {
      repoId: repo.id, owner: repoUrl.owner, name: repoUrl.name, url: repoUrl.url,
    });

    return { repo: toRepoDto(repo), created: true };
  }
}
```

**Key rule:** The use case orchestrates but does NOT implement business rules. Domain validation lives in value objects and entities, not in the service.

## Current Pattern in DevDigest

Services currently receive the entire `Container`:

```typescript
// Current
export class RepoService {
  private repo: RepoRepository;
  constructor(private container: Container) {
    this.repo = new RepoRepository(container.db);
  }
}
```

This works but couples the service to the Container (a form of service locator pattern). For stronger onion adherence, inject specific ports:

```typescript
// Stronger onion
export class RepoService {
  constructor(
    private repo: RepoRepository,    // port interface
    private jobs: JobRunner,
    private secrets: SecretsProvider,
    private git: GitClient,
  ) {}
}
```

The Container constructs the service with concrete implementations at the composition root. See [dependency-injection.md](dependency-injection.md) for details.

## DTOs (Data Transfer Objects)

DTOs are plain data objects for crossing layer boundaries. They carry no behavior.

```typescript
// Current DevDigest -- shared contracts serve as API DTOs
import { type Repo } from '@devdigest/shared';  // Zod-inferred type

// Mapper: domain entity -> API DTO
export function toRepoDto(entity: Repo): RepoDto {
  return {
    id: entity.id,
    owner: entity.owner,
    name: entity.name,
    full_name: entity.fullName,
    clone_path: entity.clonePath,
    created_at: entity.createdAt.toISOString(),
  };
}
```

In full onion there are two mapper stages:

```
DB Row  ──(infra mapper)──>  Domain Entity  ──(app mapper)──>  API DTO
```

- **Infrastructure mapper:** `row → entity` (in `repository.ts`) -- isolates domain from DB schema
- **Application mapper:** `entity → DTO` (in `service.ts` or `mappers.ts`) -- shapes data for the API consumer

## Orchestration Rules

1. **Services coordinate, domains decide.** The service calls `entity.accept()` (domain decides if valid), not `if (entity.status !== 'dismissed') entity.status = 'accepted'` (service decides).

2. **Services manage transactional boundaries.** If multiple repository writes must succeed together, the service wraps them in a transaction:

```typescript
async transferOwnership(workspaceId: string, repoId: string, newOwnerId: string): Promise<void> {
  await this.db.transaction(async (tx) => {
    await this.repoPort.updateOwner(tx, repoId, newOwnerId);
    await this.auditPort.log(tx, workspaceId, 'ownership_transfer', { repoId, newOwnerId });
  });
}
```

3. **Services don't know about HTTP.** They throw `NotFoundError`, `AppError`, or domain-specific errors. The presentation layer maps these to HTTP status codes via the error handler in `app.ts`.

4. **Services don't import from `drizzle-orm`.** If you see `import { eq } from 'drizzle-orm'` in a service file, the service is doing repository work. Extract it to the infrastructure layer.

## Error Handling

Application layer errors are domain errors, not HTTP errors:

```typescript
// CORRECT -- domain error
throw new NotFoundError(`Repository ${id} not found`);  // service layer
// Error handler in app.ts maps this to HTTP 404

// WRONG -- HTTP concern leaking into application
reply.status(404).send({ error: 'not found' });  // should be in routes.ts only
```

The error handler in `app.ts` already does this mapping:
- `AppError` -> `err.statusCode` (404, 409, etc.)
- `z.ZodError` -> 422
- Unknown -> 500
