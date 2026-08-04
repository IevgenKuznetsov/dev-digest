# Presentation Layer

The outermost layer. Translates HTTP requests into application calls and formats responses.

## What Lives Here

- **Fastify route plugins** -- HTTP endpoint definitions
- **Request/response Zod schemas** -- input validation
- **Status code mapping** -- HTTP-specific concerns
- **Context resolution** -- `getContext()` calls
- **Response formatting** -- mapping DTOs to HTTP responses

## The Four Responsibilities of a Route Handler

Every route handler should do exactly four things, in order:

```typescript
// routes.ts -- Presentation layer
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);

  app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
    // 1. Input is already validated by Zod schema (fastify-type-provider-zod)

    // 2. Resolve context (workspace + user)
    const { workspaceId, userId } = await getContext(app.container, req);

    // 3. Delegate to application service
    const { repo, created } = await service.add(workspaceId, userId, req.body.url);

    // 4. Format HTTP response
    reply.status(created ? 201 : 200);
    return repo;
  });
}
```

This is already the pattern used in DevDigest. The `reposRoutes` in `modules/repos/routes.ts` is a textbook thin presentation layer.

## Input Validation with Zod

Use `fastify-type-provider-zod` and define schemas in the route config:

```typescript
import { RepoInput } from '@devdigest/shared';
import { IdParams } from '../_shared/schemas.js';

// Schema validation happens automatically before the handler runs
app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
  // req.body is already typed and validated
});

app.delete('/repos/:id', { schema: { params: IdParams } }, async (req) => {
  // req.params.id is guaranteed to be a valid string
});
```

Validation errors are handled by the global error handler in `app.ts` -- they become 422 responses automatically. Don't catch and rethrow Zod errors in route handlers.

## What MUST NOT Be in Routes

| Violation | Example | Fix |
|-----------|---------|-----|
| Business logic | `if (repo.status === 'archived') throw ...` | Move to service or domain entity |
| Direct DB access | `import { eq } from 'drizzle-orm'` | Use service, which uses repository |
| Repository import | `import { RepoRepository } from './repository.js'` | Use service |
| Data transformation | Complex mapping/filtering logic | Move to service or domain helper |
| External API calls | Direct Octokit/LLM calls | Use service, which uses adapter ports |

## HTTP Status Codes Are Presentation Concern

The service returns data and throws domain errors. The presentation layer maps these to HTTP:

```typescript
// Service returns { repo, created: boolean }
// Route maps to HTTP semantics:
reply.status(created ? 201 : 200);
return repo;

// Service throws NotFoundError
// Error handler in app.ts maps to HTTP 404
```

Don't put HTTP status codes in service code. Don't put business decisions in route handlers.

## Service Construction

Currently services are constructed in the route plugin:

```typescript
const service = new RepoService(app.container);
```

This is the presentation layer's responsibility -- it wires the application service using the DI container. In stricter onion, the Container would expose pre-built service instances:

```typescript
// Stricter: Container provides service
const service = app.container.repoService;
```

Both approaches are valid. The current approach is simpler and works well for this codebase.

## SSE Streaming (Special Case)

SSE endpoints in `modules/reviews/routes.ts` are more complex but still follow the pattern:

```typescript
app.get('/runs/:id/events', async (req, reply) => {
  // 1. Validate params (schema)
  // 2. Resolve context (not needed for SSE subscription)
  // 3. Delegate: subscribe to container.runBus (infrastructure)
  // 4. Format: yield SSE events
  reply.sse(eventGenerator());
});
```

The SSE endpoint subscribes to an infrastructure service (`RunBus`) and formats events for the HTTP transport. The run logic itself lives in the application/infrastructure layers.

## Rules

1. **Zero business logic in routes.** If you need an `if` statement that makes a business decision, it belongs in the service.
2. **No repository or Drizzle imports.** Routes talk to services, never to repositories or the database.
3. **Let the error handler do its job.** Don't catch `AppError` or `ZodError` in routes -- the global handler in `app.ts` handles all error-to-HTTP mapping.
4. **One route plugin per module.** Each module exports a default async function that registers routes. Added to `modules/index.ts`.
5. **`getContext()` is always first.** Every authenticated route resolves workspace and user context before doing anything else.
