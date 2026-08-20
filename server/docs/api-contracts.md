# API Contracts

Conventions for defining, consuming, and evolving the shared Zod API contracts used by both the server and client.

## Location

All shared contracts live in `server/src/vendor/shared/contracts/`. They are re-exported as the `@devdigest/shared` path alias, consumed by the client via tsconfig alias (never a published npm package).

```
server/src/vendor/shared/
  contracts/
    review-api.ts       # review run, findings, outcomes
    findings.ts         # Finding shape, severity enum
    brief.ts            # PR brief / summary
    onboarding.ts       # onboarding tour schema
    intent.ts           # PR intent classifier output
    trace.ts            # run trace / audit log
    platform.ts         # workspace, user, repo shapes
    knowledge.ts        # knowledge base chunks
    observability.ts    # metrics events
    ... (one domain per file)
```

## Rules

- **Extend-only** — never edit an existing contract file. Add new fields to a `.extend()` derived type in a NEW file in the same folder. Old fields must stay at their existing paths; removing or renaming a field is a breaking change that breaks the client without a deploy.
- **Zod, not TS interfaces** — contracts are Zod schemas first; TypeScript types are inferred via `z.infer<typeof Schema>`. This gives runtime parsing for free at the API boundary.
- **`z.infer` on the consumer side** — route handlers return typed objects inferred from the same schema. Do not duplicate type declarations.
- **No business logic** — contracts are pure shape definitions. Computations, defaults, and transforms belong in the service layer.

## Adding a New Contract

1. Create `server/src/vendor/shared/contracts/<domain>.ts`.
2. Export a Zod schema and its inferred type:
   ```ts
   import { z } from 'zod';
   export const MyThing = z.object({ id: z.string(), ... });
   export type MyThing = z.infer<typeof MyThing>;
   ```
3. Re-export from `server/src/vendor/shared/index.ts`.
4. Import on the client via `import type { MyThing } from '@devdigest/shared'`.

## Evolving an Existing Contract

| Change | Allowed? | How |
|--------|----------|-----|
| Add optional field | Yes | Add `z.optional()` field to existing schema |
| Add required field | Breaking — avoid | Make optional first, backfill, then require |
| Rename field | Breaking — avoid | Add new field (optional), deprecate old in docs, remove in next major |
| Remove field | Breaking — avoid | Deprecate first; coordinate server + client deploys |
| Change field type | Breaking — avoid | Same deprecation cycle |

## Route ↔ Contract Alignment

Every Fastify route that returns data to the client must serialize through a contract type. Use `fastify.withTypeProvider<ZodTypeProvider>()` and reference the contract schema in the route's `reply` schema. This gives:

- Compile-time type safety on the reply
- Automatic JSON serialization
- Self-documenting API surface

## Duplicate Zod Instance Gotcha

`vendor/shared/` is consumed by both server and client as raw TypeScript source. If the bundler or Node module resolver loads two separate Zod instances, `instanceof z.ZodError` breaks. The server's error handler uses shape-matching as a fallback — do not remove it. The root cause is usually a mismatch between the Zod version imported directly and the one transitively bundled. Keep a single Zod version in `server/package.json` and pin it.
