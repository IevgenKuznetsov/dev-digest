# Infrastructure Layer

Implements interfaces defined by inner layers. Contains all external system integrations.

## What Lives Here

- **Repository implementations** -- Drizzle queries implementing domain port interfaces
- **Adapter implementations** -- external API clients (GitHub, LLM, Git)
- **DB-row-to-entity mappers** -- convert Drizzle row types to domain entities
- **Schema definitions** -- Drizzle table definitions in `db/schema/`

## Repository Implementations

Repositories take a `Db` (Drizzle instance), implement the domain's repository interface, and return domain entities:

```typescript
// infrastructure/repository.ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Repo, RepoRepository as IRepoRepository, InsertRepo } from '../domain/ports.js';

export class DrizzleRepoRepository implements IRepoRepository {
  constructor(private db: Db) {}

  async findByFullName(workspaceId: string, fullName: string): Promise<Repo | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)));
    return row ? toEntity(row) : undefined;
  }

  async insert(values: InsertRepo): Promise<Repo> {
    const [row] = await this.db
      .insert(t.repos)
      .values(values)
      .returning();
    return toEntity(row!);
  }
}
```

**Key differences from current pattern:**
1. Class explicitly `implements` the domain interface
2. All methods return domain entities, not `typeof t.repos.$inferSelect`
3. The `toEntity()` mapper is private infrastructure concern

## Row-to-Entity Mappers

Mappers isolate the domain from database schema changes:

```typescript
// infrastructure/mappers.ts
import type { Repo } from '../domain/entities.js';

type RepoRow = typeof t.repos.$inferSelect;

function toEntity(row: RepoRow): Repo {
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

If a column is renamed in a migration, only the mapper changes -- the domain entity and all service code remain untouched.

## Adapter Pattern for External Services

The project already follows the adapter pattern for external services:

```typescript
// Port (interface) -- defined in @devdigest/shared
export interface GitHubClient {
  listPullRequests(repo: RepoRef): Promise<PrMeta[]>;
  getPullRequestDetail(repo: RepoRef, number: number): Promise<PrDetail>;
}

// Adapter (implementation) -- in adapters/github/octokit.ts
export class OctokitGitHubClient implements GitHubClient {
  constructor(private token: string) {}

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(async () => {
        const res = await this.octokit.rest.pulls.list({ owner: repo.owner, repo: repo.name });
        return res.data.map(mapPrMeta);
      }, TIMEOUT)
    );
  }
}
```

**Current adapters in DevDigest:**

| Port Interface | Adapter(s) | Location |
|---------------|-----------|----------|
| `GitHubClient` | `OctokitGitHubClient` | `adapters/github/octokit.ts` |
| `LLMProvider` | `OpenAIProvider`, `AnthropicProvider`, `OpenRouterProvider` | `adapters/llm/` |
| `GitClient` | `SimpleGitClient` | `adapters/git/simple-git.ts` |
| `CodeIndex` | `RipgrepCodeIndex` | `adapters/codeindex/ripgrep.ts` |
| `Embedder` | `OpenAIEmbedder` | `adapters/embedder/openai.ts` |
| `SecretsProvider` | `LocalSecretsProvider` | `adapters/secrets/local.ts` |
| `AuthProvider` | `LocalNoAuthProvider` | `adapters/auth/local.ts` |

## Lazy Construction and Caching

Container constructs adapters lazily and caches them:

```typescript
// Sync getter -- no secrets needed
get git(): GitClient {
  if (this.overrides.git) return this.overrides.git;
  this._git ??= new SimpleGitClient(this.config.cloneDir);
  return this._git;
}

// Async getter -- needs secrets
async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;
  if (this._github) return this._github;
  const token = await this.secrets.get('GITHUB_TOKEN');
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
  this._github = new OctokitGitHubClient(token);
  return this._github;
}
```

**Pattern:** Sync getters for adapters that don't need secrets. Async methods for adapters that need secret resolution. `ContainerOverrides` checked first (test path), then lazy construction (production path).

## Multiple Implementations

The LLM adapter demonstrates one port with multiple implementations:

```typescript
async llm(id: string): Promise<LLMProvider> {
  if (this.overrides.llm?.[id]) return this.overrides.llm[id];
  if (this.llmCache.has(id)) return this.llmCache.get(id)!;

  const key = await this.secrets.get(secretKeyFor(id));
  const provider = createProvider(id, key);  // OpenAI | Anthropic | OpenRouter
  this.llmCache.set(id, provider);
  return provider;
}
```

All three providers implement the same `LLMProvider` interface. The service does not know which implementation it is talking to.

## Rules

1. **All Drizzle imports stay in this layer.** `import { eq, and } from 'drizzle-orm'` and `import * as t from '../../db/schema.js'` must only appear in repository files.
2. **Repositories return domain entities**, not raw row types. The mapper is an infrastructure concern.
3. **Adapters implement interfaces** defined in inner layers. Never define the interface in the adapter file.
4. **Resilience (retry, timeout) is an infrastructure concern.** `withRetry()` and `withTimeout()` wrap adapter calls, not service calls.
5. **Infrastructure never imports from Presentation.** No Fastify types in repository or adapter files.
