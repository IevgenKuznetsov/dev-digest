# The Dependency Rule

> "All code can depend on layers more central, but code cannot depend on layers further out from the core."
> -- Jeffrey Palermo, [The Onion Architecture (2008)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)

## The Cardinal Rule

Source code dependencies may ONLY point inward, toward higher-level policy. This is the single rule from which all other onion architecture rules derive.

```
                    ┌──────────────────────────────┐
                    │       Presentation           │
                    │  ┌────────────────────────┐  │
                    │  │    Infrastructure       │  │
                    │  │  ┌──────────────────┐  │  │
                    │  │  │   Application     │  │  │
                    │  │  │  ┌────────────┐  │  │  │
                    │  │  │  │   Domain    │  │  │  │
                    │  │  │  └────────────┘  │  │  │
                    │  │  └──────────────────┘  │  │
                    │  └────────────────────────┘  │
                    └──────────────────────────────┘

               Dependencies always point INWARD →→→
```

## Interface Inversion

Inner layers define **interfaces** (ports); outer layers provide **implementations** (adapters). This is how control flows outward at runtime while source dependencies point inward.

```typescript
// DOMAIN layer — defines the port (interface)
// Lives in: @devdigest/shared or modules/<name>/domain/ports.ts
export interface GitHubClient {
  listPullRequests(repo: RepoRef): Promise<PrMeta[]>;
  getPullRequestDetail(repo: RepoRef, number: number): Promise<PrDetail>;
}

// INFRASTRUCTURE layer — provides the adapter (implementation)
// Lives in: adapters/github/octokit.ts
export class OctokitGitHubClient implements GitHubClient {
  constructor(private token: string) { /* ... */ }
  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() => withTimeout(/* Octokit calls */));
  }
}

// COMPOSITION ROOT — wires adapter to port
// Lives in: platform/container.ts
async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;  // Test mock
  if (this._github) return this._github;                    // Cached
  const token = await this.secrets.get('GITHUB_TOKEN');
  this._github = new OctokitGitHubClient(token);
  return this._github;
}
```

The service layer depends on `GitHubClient` (the interface), never on `OctokitGitHubClient` (the implementation). The Container resolves the concrete type at runtime.

## Import Direction Check

A practical heuristic for detecting violations -- check what each layer imports:

| Layer | MUST NOT import from |
|-------|---------------------|
| **Domain** (`domain/`, `helpers.ts`, `constants.ts`) | `drizzle-orm`, `fastify`, `../../adapters/`, any npm package |
| **Application** (`service.ts`) | `drizzle-orm`, `fastify`, `../../adapters/` |
| **Infrastructure** (`repository.ts`, `adapters/`) | `fastify`, route files |
| **Presentation** (`routes.ts`) | `drizzle-orm`, `../../db/schema`, repository files directly |

If a `domain/` file imports from `drizzle-orm`, the dependency rule is violated. If `routes.ts` imports from `repository.ts` directly (bypassing the service), the layer skip indicates a missing use case.

## Existing Pattern in DevDigest

The project already follows the dependency rule at the adapter level:

- **Port interfaces** live in `@devdigest/shared`: `GitHubClient`, `LLMProvider`, `GitClient`, `CodeIndex`, `Embedder`, `AuthProvider`, `SecretsProvider`
- **Adapter implementations** live in `server/src/adapters/`: `OctokitGitHubClient`, `OpenAIProvider`, `SimpleGitClient`, `RipgrepCodeIndex`, etc.
- **Container** (`platform/container.ts`) wires adapters to ports via lazy getters and `ContainerOverrides` for test mocks

The gap is at the **module level**: repository classes return raw Drizzle row types (`RepoRow = typeof t.repos.$inferSelect`) rather than domain entities, and services take the whole `Container` rather than specific ports. These are areas for incremental improvement.

## Rules of Thumb

1. **If you are adding an `import` that crosses a layer boundary outward, stop.** Introduce an interface in the inner layer instead.
2. **Any outer layer can call any inner layer** -- not just the one directly below. A route handler can use domain constants directly.
3. **The composition root is the only place that knows all concrete implementations.** No other file should import from multiple adapter directories.
