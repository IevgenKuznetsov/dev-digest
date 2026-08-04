# Layer Structure

The four concentric layers of Onion Architecture, mapped to the DevDigest codebase.

> Reference: [Herberto Graca -- Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/)

## Layer 1: Domain (Innermost)

**Contains:** Core business logic, entities, value objects, repository interfaces (ports), domain services, domain events, business rules.

**Depends on:** Nothing. Zero external dependencies. Pure TypeScript types and functions.

**DevDigest equivalents:**
- `helpers.ts` -- pure transforms (`parseRepoUrl`, `toRepoDto`, `findingRowToDto`)
- `constants.ts` -- domain literals (`CLONE_JOB_KIND`, `CLONE_DEPTH`)
- `types.ts` -- facade interfaces (`RepoIntel` in `modules/repo-intel/types.ts`)
- `@devdigest/shared` adapter interfaces -- `GitHubClient`, `LLMProvider`, `GitClient`, etc.

**Rules:**
- No `import` from `drizzle-orm`, `fastify`, `octokit`, or any infrastructure package
- Entities validate their own invariants (not just data bags)
- Repository interfaces defined here return domain entities, not DB rows

## Layer 2: Application

**Contains:** Use cases (service methods), application services, DTOs, mappers between domain entities and DTOs, orchestration logic.

**Depends on:** Domain layer only. May use Zod for DTO validation. Must NOT import Drizzle or Fastify.

**DevDigest equivalents:**
- `service.ts` files -- `RepoService`, `ReviewService`, `AgentsService`
- Service methods are use cases: `add()`, `list()`, `refresh()`, `runReview()`
- Shared contracts in `@devdigest/shared` serve as API DTOs

**Rules:**
- Orchestrates domain objects and repository ports to accomplish user goals
- Manages transactional boundaries
- References infrastructure only through interfaces (ports) defined in the domain
- Should NOT contain business rules (those belong in Domain)
- Throws domain errors (`NotFoundError`, `AppError`), not HTTP errors

## Layer 3: Infrastructure

**Contains:** Concrete repository implementations (Drizzle), external API clients, message queue adapters, DB-row-to-entity mappers.

**Depends on:** Domain and Application layers. Implements interfaces defined by inner layers.

**DevDigest equivalents:**
- `repository.ts` files -- `RepoRepository`, `ReviewRepository`, `AgentsRepository`
- `adapters/` directory -- `OctokitGitHubClient`, `OpenAIProvider`, `SimpleGitClient`, `RipgrepCodeIndex`
- DB schema definitions in `db/schema/`

**Rules:**
- All Drizzle `select()`, `insert()`, `update()`, `delete()` calls live here exclusively
- Mapper functions convert between DB row types and domain entities
- Implements repository interfaces defined in the domain layer
- Multiple implementations per port are allowed (e.g., 3 LLM providers)

## Layer 4: Presentation (Outermost)

**Contains:** HTTP controllers/routes, request/response Zod schemas, middleware, status codes.

**Depends on:** Application layer (and transitively Domain). Never directly on Infrastructure.

**DevDigest equivalents:**
- `routes.ts` files -- Fastify plugins that register HTTP endpoints
- `_shared/context.ts` -- `getContext()` for workspace/user resolution
- `_shared/schemas.ts` -- common Zod schemas (`IdParams`)

**Rules:**
- Routes do exactly four things: (1) validate input, (2) resolve context, (3) delegate to service, (4) format response
- Zero business logic
- No direct repository access -- routes call services only
- HTTP status codes are a presentation concern, not an application concern
- Multiple presentation layers can coexist (REST, GraphQL, CLI, SSE)

## Cross-Layer Data Flow

```
Request → Presentation → Application → Domain ← Infrastructure
                                          ↑
                              (implements interfaces)
```

1. **Inbound:** HTTP request hits `routes.ts` (Presentation) → calls `service.method()` (Application) → orchestrates domain entities and repository ports (Domain)
2. **Outbound:** Repository port call resolved by Container to `repository.ts` (Infrastructure) → Drizzle query → DB row → mapper → domain entity returned to Application
3. **Response:** Application returns DTO → Presentation formats HTTP response

## Mapping Current Flat Structure to Layers

| File | Layer | Notes |
|------|-------|-------|
| `routes.ts` | Presentation | Already thin -- delegates to service |
| `service.ts` | Application | Orchestrates logic, calls repository |
| `repository.ts` | Infrastructure | Drizzle queries, returns DB row types |
| `helpers.ts` | Domain | Pure transforms, no external deps |
| `constants.ts` | Domain | Literals and magic strings |
| `types.ts` | Domain | Interfaces and type definitions |

The current flat structure maps naturally to onion layers. The main gap is that `repository.ts` returns raw Drizzle row types instead of domain entities, coupling the application layer to the database schema.
