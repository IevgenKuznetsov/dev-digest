# Testing Strategy

How onion architecture enables a clean testing pyramid with isolated, fast tests at each layer.

## Testing Pyramid by Layer

```
                    ┌─────────────┐
                    │   E2E       │  scripts/e2e.sh (hermetic, isolated ports)
                    ├─────────────┤
                    │ Presentation│  *.test.ts with app.inject() + mock Container
                    ├─────────────┤
                    │ Application │  *.test.ts with mock ports (ContainerOverrides)
                    ├─────────────┤
                    │Infrastructure│  *.it.test.ts against real Postgres (Docker)
                    ├─────────────┤
                    │   Domain    │  *.test.ts — pure unit, no mocks needed
                    └─────────────┘
```

## Domain Layer Tests (Unit)

Pure functions and entities. No mocks, no DB, no network. The fastest and most reliable tests.

```typescript
// domain/__tests__/repo-url.test.ts
import { describe, it, expect } from 'vitest';
import { RepoUrl } from '../value-objects.js';

describe('RepoUrl', () => {
  it('parses HTTPS GitHub URL', () => {
    const url = new RepoUrl('https://github.com/acme/payments-api');
    expect(url.owner).toBe('acme');
    expect(url.name).toBe('payments-api');
    expect(url.fullName).toBe('acme/payments-api');
  });

  it('rejects non-GitHub URL', () => {
    expect(() => new RepoUrl('https://gitlab.com/foo/bar')).toThrow();
  });
});
```

**Current examples:** `parseRepoUrl` in `helpers.ts` could be tested this way today -- it's already pure.

**File naming:** `*.test.ts` (no `.it.` suffix) -- runs without Docker.

## Application Layer Tests (Unit + Mock Ports)

Test use cases by injecting mock repositories and adapters. Verify orchestration logic without DB or network.

```typescript
// application/__tests__/repo-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RepoService } from '../service.js';

describe('RepoService.add', () => {
  it('returns existing repo without creating duplicate', async () => {
    const mockRepo = {
      findByFullName: vi.fn().mockResolvedValue({ id: '1', fullName: 'acme/api' }),
      insert: vi.fn(),
    };
    const mockJobs = { enqueue: vi.fn(), register: vi.fn() };

    const service = new RepoService(mockRepo, mockJobs, /* ... */);
    const result = await service.add('ws-1', 'user-1', 'https://github.com/acme/api');

    expect(result.created).toBe(false);
    expect(mockRepo.insert).not.toHaveBeenCalled();
    expect(mockJobs.enqueue).not.toHaveBeenCalled();
  });
});
```

**Current pattern:** Services take `Container`. For testing with mocks, use `ContainerOverrides`:

```typescript
import { buildApp } from '../../app.js';
import { MockGitHubClient } from '../../adapters/mocks.js';

const app = await buildApp({
  config: testConfig,
  overrides: { github: new MockGitHubClient(/* fixtures */) },
});
```

**File naming:** `*.test.ts` -- runs without Docker.

## Infrastructure Layer Tests (Integration)

Test Drizzle repositories against a real PostgreSQL database. Verify queries, constraints, cascade deletes.

```typescript
// infrastructure/__tests__/repo-repository.it.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { RepoRepository } from '../repository.js';

describe('RepoRepository', () => {
  let db: Db;
  let repo: RepoRepository;

  beforeAll(async () => {
    db = await createTestDb();  // real Postgres via Docker
    repo = new RepoRepository(db);
  });

  it('inserts and retrieves by full name', async () => {
    const inserted = await repo.insert({
      workspaceId: 'ws-1', owner: 'acme', name: 'api',
      fullName: 'acme/api', createdBy: 'user-1',
    });

    const found = await repo.findByFullName('ws-1', 'acme/api');
    expect(found?.id).toBe(inserted.id);
  });

  it('scopes queries by workspaceId', async () => {
    await repo.insert({ workspaceId: 'ws-2', owner: 'acme', name: 'api', /* ... */ });
    const found = await repo.findByFullName('ws-1', 'acme/api');
    expect(found?.workspaceId).toBe('ws-1');
  });
});
```

**File naming:** `*.it.test.ts` -- needs Docker/Postgres. The `.it.` suffix drives the unit/integration split per project conventions.

**Run command:**
```bash
pnpm exec vitest run .it.test  # integration only
```

## Presentation Layer Tests (HTTP)

Use Fastify's `app.inject()` for request/response testing. Inject mock container overrides.

```typescript
// presentation/__tests__/routes.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../../app.js';
import { MockGitHubClient } from '../../../adapters/mocks.js';

describe('POST /repos', () => {
  it('returns 201 for new repo', async () => {
    const app = await buildApp({
      config: testConfig,
      overrides: {
        github: new MockGitHubClient(),
        git: { clone: vi.fn().mockResolvedValue({ path: '/tmp/repo' }) },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/payments-api' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ owner: 'acme', name: 'payments-api' });
  });

  it('returns 422 for invalid URL', async () => {
    const app = await buildApp({ config: testConfig });
    const res = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'not-a-url' },
    });
    expect(res.statusCode).toBe(422);
  });
});
```

**File naming:** `*.test.ts` -- mock adapters mean no Docker needed.

## Mock Location

All shared mock implementations live in `server/src/adapters/mocks.ts`:

```typescript
// adapters/mocks.ts
export class MockGitHubClient implements GitHubClient { /* ... */ }
export class MockLLMProvider implements LLMProvider { /* ... */ }
export class MockGitClient implements GitClient { /* ... */ }
```

**Rule from CLAUDE.md:** When an interface changes, update the mock. `adapters/mocks.ts` is a "do not touch" file -- meaning don't break it, but do keep it in sync with interface changes.

## Test Commands

```bash
# Unit tests only (no Docker)
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'

# Integration tests only (needs Docker)
cd server && pnpm exec vitest run .it.test

# All tests
cd server && pnpm test

# E2E (hermetic, isolated ports)
./scripts/e2e.sh
```

## How Onion Enables Better Testing

| Without Onion | With Onion |
|---------------|------------|
| Domain logic coupled to DB -- every test needs Docker | Domain tested in isolation -- pure unit tests |
| Service tests require real adapters | Services tested with mock ports |
| Route changes break service tests | Layers change independently |
| Mocking is fragile (mock internal implementation) | Mocking is stable (mock interface contracts) |
| Tests are slow (DB + network) | Most tests are fast (pure logic + mock ports) |

## Rules

1. **Domain tests need zero infrastructure.** If a domain test needs a database or mock, the domain layer has infrastructure leaking in.
2. **Use `ContainerOverrides` for mock injection.** Don't construct mock adapters ad-hoc -- use the shared mocks in `adapters/mocks.ts`.
3. **Integration tests use `.it.test.ts` suffix.** This drives the CI split between unit and integration runs.
4. **Test the contract, not the implementation.** Mock at the port interface level, not at the internal implementation level.
5. **Each layer can be tested independently.** This is the primary practical benefit of onion architecture.
