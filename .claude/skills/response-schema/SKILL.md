---
name: response-schema
description: "Detects changes to API response shapes — field types, optionality, renames, envelope restructuring. TRIGGER: when a diff modifies Zod schemas in vendor/shared/contracts/, route handler return values, Drizzle .select() shapes, or mapper functions that transform DB rows to API responses. Covers Fastify + Zod + Drizzle response contracts."
---

# Response Schema Review

Flag changes to the shape of API responses that break client deserialization. Response shape includes field names, types, optionality, nullability, nesting, and envelope structure.

## When to Use

- Zod schema modified in `server/src/vendor/shared/contracts/*.ts`
- Route handler return value changed in `server/src/modules/*/routes.ts`
- Drizzle `.select()` shape changed in `server/src/modules/*/repository.ts`
- Mapper function modified that transforms DB rows to API DTOs

## Rules

1. **Removed response field** — a field deleted from a Zod response schema or a route handler's return object. Clients destructuring by name will get `undefined` instead of the expected value.
2. **Field type changed** — `z.string()` → `z.number()`, `z.array()` → `z.object()`, or any primitive swap. Since the project uses `z.infer<>`, type changes propagate to TypeScript types and break compile-time contracts.
3. **Optional to required** — changing `z.string().optional()` to `z.string()` is a breaking change: old responses that omitted the field become invalid. The reverse (required → optional) is safe for consumers but changes the TS type.
4. **Nullable to non-nullable** — removing `.nullable()` or `.nullish()` from a field that consumers may null-check. Example: `ReviewRecord.verdict` is `Verdict.nullable()` — removing `.nullable()` breaks null-handling code.
5. **Renamed field** — changing the key name in a Zod schema or return object. Consumers destructure by name, not position.
6. **Envelope structure change** — wrapping a bare array in `{ data: [], total: N }` or unwrapping an envelope to a bare array. Both break consumer parsing logic.
7. **Drizzle select shape drift** — when a repository `.select()` changes columns, the mapper must update, and if the mapper feeds a Zod contract, the contract must stay stable. Trace the full chain: `Drizzle .select()` → mapper → route return → Zod contract.
8. **Error response shape change** — the project uses `AppError` subclasses from `platform/errors.ts`. Changing error serialization format (status code field name, error body structure) breaks client error handling.
9. **Nested object restructuring** — flattening `{ findings: [{ severity }] }` into `{ findings_severity: [] }` or vice versa changes the access path for every consumer.

## Examples

### Bad — remove field from shared contract

```typescript
// server/src/vendor/shared/contracts/findings.ts
// ❌ Client code doing `review.verdict` now gets undefined
export const ReviewRecord = z.object({
  id: z.string().uuid(),
  repo_id: z.string().uuid(),
  // verdict was removed — consumers break
  findings_count: z.number(),
});
```

### Good — deprecate field, add replacement

```typescript
export const ReviewRecord = z.object({
  id: z.string().uuid(),
  repo_id: z.string().uuid(),
  verdict: Verdict.nullable().describe('DEPRECATED: use outcome instead'),
  outcome: Verdict.nullable(), // new canonical field
  findings_count: z.number(),
});
```

### Bad — change envelope structure

```typescript
// Route handler previously returned { data: skills, total: count }
// ❌ Now returns bare array — clients parsing .data break
app.get('/skills', async () => {
  const skills = await service.list();
  return skills; // was: { data: skills, total: skills.length }
});
```

### Good — version the endpoint for new shape

```typescript
// Keep /v1/skills returning the old envelope
app.get('/skills', async () => {
  const skills = await service.list();
  return { data: skills, total: skills.length };
});
// New shape at /v2/skills
app.get('/v2/skills', async () => service.list());
```

### Bad — Drizzle select drift breaks response

```typescript
// repository.ts — removed `enabled` from select
const rows = await db.select({
  id: skills.id,
  name: skills.name,
  // enabled: skills.enabled  ← removed from select
}).from(skills);

// routes.ts — still returns the row, but `enabled` is now missing
// ❌ Client sees { id, name } instead of { id, name, enabled }
```

### Good — keep select stable or update contract

```typescript
// If removing from select, also update the Zod contract to mark optional
// and document the change in CHANGELOG
const rows = await db.select({
  id: skills.id,
  name: skills.name,
}).from(skills);
// Update contract: enabled: z.boolean().optional()
```

## Severity Mapping

| Severity | Criteria |
|----------|----------|
| **CRITICAL** | Removed field from `vendor/shared/` contract, field type change, renamed field |
| **WARNING** | Nullable → non-nullable, envelope restructure, error shape change |
| **SUGGESTION** | New optional field added (safe but note in changelog), internal DTO refactor |

## Exceptions

1. **New optional fields** — adding `.optional()` or `.nullish()` fields is always safe
2. **Internal DTOs** — types not exported from `@devdigest/shared`
3. **Versioned endpoints** — changes behind a new version prefix (`/v2/`) don't break existing consumers
4. **Test response fixtures** — mock data in test files
5. **Error responses for new error codes** — adding new error types doesn't break existing error handling