---
name: breaking-change
description: "Detects breaking changes to public API contracts. TRIGGER: when a diff removes or renames a Fastify route, Zod contract field, Drizzle column, Docker compose service, or TypeScript export from @devdigest/shared. Covers REST endpoints, shared types, database schema, and infrastructure contracts in a Fastify + Drizzle + PostgreSQL + Docker stack."
metadata:
  author: ievgen.kuznetsov@gmail.com
  version: 0.1.0
---

# Breaking Change Detection

Flag changes that break existing consumers of public API contracts. A change is "public" if it affects anything exported from `@devdigest/shared`, returned by a Fastify route handler, or exposed via Docker compose.

## When to Use

- Route handler deleted or HTTP method/path changed in `server/src/modules/*/routes.ts`
- Field removed or renamed in `server/src/vendor/shared/contracts/*.ts`
- Column dropped, renamed, or type-narrowed in `server/src/db/schema/*.ts`
- Service renamed, removed, or port changed in `docker-compose.yml`
- Export removed from `server/src/vendor/shared/index.ts`

## Rules

1. **Removed Fastify route** — deleting a route handler or changing its HTTP method/path breaks every consumer calling that endpoint. This includes renaming the URL prefix registered in `modules/index.ts`.
2. **Removed or renamed Zod contract field** — fields in `vendor/shared/contracts/*.ts` are the public API surface. Removing a field from `ReviewRecord`, `Finding`, `Skill`, etc. breaks client deserialization.
3. **Removed Zod enum variant** — removing a value from `z.enum()` (e.g., `Severity`, `Verdict`, `SkillType`) breaks clients that send or match on that value. Adding new variants is safe.
4. **Drizzle column dropped or renamed** — dropping or renaming a column in `db/schema/*.ts` requires a migration and breaks any query selecting that column. The barrel export in `db/schema.ts` makes schema globally visible.
5. **Drizzle column type narrowed** — changing `text()` to `text({ enum: [...] })`, adding `.notNull()` to a nullable column, or reducing a varchar length rejects previously valid data.
6. **Changed HTTP status code** — changing a success status code (e.g., `reply.status(201)` → `reply.status(200)`) breaks consumers that check exact codes.
7. **Tightened request validation** — making an optional Zod field required, adding new required fields to request body schemas, or narrowing an accepted type. Widening (required → optional) is safe.
8. **Docker compose service change** — renaming a service, changing exposed ports (e.g., `5433:5432`), removing a volume mount, or changing the base image tag.
9. **Removed TypeScript export** — removing any export from `@devdigest/shared` barrel. The project convention states: "extend with new files only, never edit existing contracts."
10. **Changed route param type** — altering path/query parameter schemas (e.g., `z.string().uuid()` → `z.coerce.number()`).
11. **Removed Fastify plugin decoration** — removing a property from `container.ts` or a plugin's `decorate()` call breaks any downstream plugin that reads it.

## Examples

### Bad — silently delete a route

```typescript
// server/src/modules/skills/routes.ts
// ❌ This route was removed — clients now get 404
- app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
-   return service.stats(req.params.id);
- });
```

### Good — deprecate before removing

```typescript
// Keep the route alive, add deprecation header, delegate to new implementation
app.get('/skills/:id/stats', {
  schema: { params: IdParams },
  onSend: async (_req, reply) => {
    reply.header('Deprecation', 'true');
    reply.header('Sunset', 'Wed, 01 Oct 2026 00:00:00 GMT');
  },
}, async (req) => {
  return service.stats(req.params.id); // remove in next MAJOR
});
```

### Bad — remove a Zod contract field

```typescript
// server/src/vendor/shared/contracts/findings.ts
// ❌ Clients destructuring `severity` will break
export const Finding = z.object({
  id: z.string().uuid(),
  // severity: Severity,  ← removed
  category: FindingCategory,
  body: z.string(),
});
```

### Good — keep old field, introduce replacement

```typescript
export const Finding = z.object({
  id: z.string().uuid(),
  severity: Severity.optional(), // deprecated — use `level` instead
  level: Severity,               // new canonical field
  category: FindingCategory,
  body: z.string(),
});
```

### Bad — drop a Drizzle column in one migration

```sql
-- ❌ Existing rows and queries referencing this column will fail
ALTER TABLE reviews DROP COLUMN verdict;
```

### Good — phased column migration

```
1. Add new column alongside old  →  MINOR release
2. Backfill data, update queries to read new column
3. Deprecate old column (stop writing, mark @deprecated)
4. Drop old column  →  MAJOR release
```

## Severity Mapping

| Severity | Criteria |
|----------|----------|
| **CRITICAL** | Removed endpoint, removed/renamed response field, dropped DB column, removed `@devdigest/shared` export |
| **WARNING** | Changed status code, tightened validation, Docker port change, narrowed column type |
| **SUGGESTION** | Renamed internal type not in `@devdigest/shared`, stricter lint rule |

## Exceptions

1. **Additive changes** — new optional fields, new endpoints, new enum variants are always safe
2. **Internal types** — types not re-exported from `@devdigest/shared` barrel
3. **Test files** — `*.test.ts`, `*.it.test.ts`, test fixtures
4. **Seed data and migrations** — schema changes in migration files are expected; flag only if no corresponding version bump
5. **Alpha/unstable endpoints** — documented as experimental (e.g., behind a feature flag or `// @unstable` comment)

> **Remediation:** see `deprecation-policy` skill for the correct removal workflow.
