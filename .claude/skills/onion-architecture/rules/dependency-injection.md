# Dependency Injection

The composition root pattern: one place that wires all concrete implementations to abstract interfaces.

## Composition Root

`server/src/platform/container.ts` is the composition root. It is the **only file** that knows about all concrete adapter implementations:

```typescript
// container.ts imports BOTH interfaces and implementations
import type { GitHubClient, GitClient, LLMProvider } from '@devdigest/shared';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
// ... all other concrete adapter imports
```

No other file in the codebase should import from multiple adapter directories. Services depend on interfaces, Container wires the concrete classes.

## Container Class

DevDigest uses **manual DI** via a class with lazy getters -- no DI framework (Inversify, tsyringe, Awilix). This is simpler and sufficient for the project's complexity.

```typescript
export class Container {
  // Eagerly resolved (needed immediately)
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  // Lazily resolved (sync -- no secrets needed)
  get git(): GitClient { /* ... */ }
  get codeIndex(): CodeIndex { /* ... */ }
  get agentsRepo(): AgentsRepository { /* ... */ }
  get reviewRepo(): ReviewRepository { /* ... */ }

  // Lazily resolved (async -- needs secrets)
  async github(): Promise<GitHubClient> { /* ... */ }
  async llm(id: string): Promise<LLMProvider> { /* ... */ }
  async embedder(): Promise<Embedder> { /* ... */ }

  constructor(config: AppConfig, db: Db, private overrides: ContainerOverrides = {}) {
    // Wire eagerly-needed dependencies
  }
}
```

**Pattern rules:**
- **Sync getters** for adapters that don't need secrets (Git, CodeIndex)
- **Async methods** for adapters that fetch secrets on first call (GitHub, LLM, Embedder)
- **Lazy construction** -- only built when first accessed, reducing startup time
- **Caching** -- LLM providers cached by id; secrets cached by SecretsProvider

## ContainerOverrides for Testing

Tests inject mock implementations via the `ContainerOverrides` interface:

```typescript
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  repoIntel?: RepoIntel;
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
}
```

Each lazy getter checks overrides first:

```typescript
get git(): GitClient {
  if (this.overrides.git) return this.overrides.git;   // Test path
  this._git ??= new SimpleGitClient(this.config.cloneDir);  // Production path
  return this._git;
}
```

## Test Injection Example

```typescript
import { buildApp } from '../../app.js';
import { MockGitHubClient, MockLLMProvider } from '../../adapters/mocks.js';

const app = await buildApp({
  config: testConfig,
  overrides: {
    github: new MockGitHubClient(/* test fixtures */),
    llm: { openai: new MockLLMProvider(/* canned responses */) },
  },
});

// The service under test receives mocks transparently
const res = await app.inject({ method: 'POST', url: '/repos', payload: { url: '...' } });
```

The service is completely unaware it is receiving a mock. This is the adapter pattern at work -- the service talks to the `GitHubClient` interface, and the Container provides either the real Octokit or a mock.

## Cross-Module Repositories

Some repositories serve multiple modules. These are constructed in the Container rather than inside a single module:

```typescript
// Container exposes these as lazy getters
get agentsRepo(): AgentsRepository {
  return (this._agentsRepo ??= new AgentsRepository(this.db));
}

get reviewRepo(): ReviewRepository {
  return (this._reviewRepo ??= new ReviewRepository(this.db));
}
```

This prevents modules from reaching into each other's internals. `modules/reviews/service.ts` uses `container.agentsRepo` instead of importing from `modules/agents/repository.js`.

## Secret Invalidation

When secrets change (e.g., user updates API keys via settings), cached adapters must be invalidated:

```typescript
invalidateSecretCaches(): void {
  this._github = undefined;
  this._embedder = undefined;
  this.llmCache.clear();
}
```

This is called after the settings module updates secrets. The next `github()` or `llm()` call will re-fetch the new key and construct a fresh adapter.

## Rules

1. **Container is the only composition root.** No other file should construct multiple adapter implementations.
2. **Services receive interfaces, not implementations.** Depend on `GitHubClient`, not `OctokitGitHubClient`.
3. **Prefer specific ports over whole Container.** When refactoring, inject the specific interfaces a service needs rather than the entire Container.
4. **Overrides are for testing only.** Production code should never pass `ContainerOverrides`.
5. **Async getters for secret-dependent adapters.** Callers must handle async resolution (`await container.github()`).
6. **Mock implementations live in `adapters/mocks.ts`.** When an interface changes, update the mock. See `CLAUDE.md` do-not-touch rules.
