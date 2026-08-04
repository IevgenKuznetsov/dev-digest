---
name: deprecation-policy
description: "Enforces proper deprecation workflow instead of silent removal. TRIGGER: when a diff deletes a public function, route, type, Drizzle column, or export without a deprecation phase. Covers JSDoc @deprecated, HTTP Deprecation/Sunset headers (RFC 8594), migration guides, and dual-path periods for Fastify + Drizzle + Docker stacks."
metadata:
   author: ievgen.kuznetsov@gmail.com
   version: 0.1.0
---

# Deprecation Policy

Anything consumed by other modules or external clients must go through a deprecation cycle before removal. Silent deletion breaks consumers without warning. This skill provides the "how to fix" when `breaking-change` flags a removal.

## When to Use

- Code deletes a public function, route, type, or DB column
- Feature removed without providing an alternative
- Export removed from `server/src/vendor/shared/index.ts`
- Route handler deleted from `server/src/modules/*/routes.ts`

## Rules

1. **Never silently remove** — anything in `vendor/shared/`, any Fastify route, or any Drizzle column used by other modules must go through deprecation before deletion. The project convention states: "extend with new files only, never edit existing contracts."

2. **JSDoc `@deprecated` annotation** — add `@deprecated` with a message pointing to the replacement. TypeScript IDEs render this as strikethrough, giving developers immediate visual feedback.

```typescript
/** @deprecated Use `outcome` instead. Will be removed in v3.0. */
verdict: Verdict.nullable(),
```

3. **HTTP `Deprecation` header** — deprecated Fastify endpoints must return the `Deprecation` header (RFC 8594). Use a route-level `onSend` hook.

```typescript
app.get('/skills/:id/stats', {
  schema: { params: IdParams },
  onSend: async (_req, reply) => {
    reply.header('Deprecation', 'true');
    reply.header('Link', '</v2/skills/:id/analytics>; rel="successor-version"');
  },
}, handler);
```

4. **`Sunset` header with removal date** — set `Sunset: <HTTP-date>` alongside `Deprecation` to communicate the timeline. Minimum deprecation period: 2 minor versions or 30 days, whichever is longer.

```typescript
reply.header('Sunset', 'Wed, 01 Oct 2026 00:00:00 GMT');
```

5. **Log deprecation warnings** — when a deprecated endpoint or function is called, log a warning with caller context. Use Fastify's built-in logger.

```typescript
req.log.warn(
  { route: req.url, replacement: '/v2/skills/:id/analytics' },
  'Deprecated endpoint called — will be removed after 2026-10-01'
);
```

6. **Migration guide required** — every deprecation must include documentation: what changed, the new API/function/endpoint, and a code example. Add to CHANGELOG or a `docs/migrations/` file.

7. **Dual-path period** — during deprecation, both old and new paths must work. The old path should delegate to the new implementation internally to avoid maintaining two code paths.

```typescript
// Old route delegates to new implementation
app.get('/skills/:id/stats', deprecatedHandler, async (req) => {
  return service.analytics(req.params.id); // same impl as /v2/
});
```

8. **Zod schema deprecation** — mark deprecated fields with `.describe('DEPRECATED: use X instead')` and keep them as `.optional()`. Do not remove until the next MAJOR version.

```typescript
// ✅ Both fields coexist during deprecation
export const ReviewRecord = z.object({
  verdict: Verdict.nullable().optional()
    .describe('DEPRECATED: use outcome instead'),
  outcome: Verdict.nullable(), // new canonical field
});
```

9. **Drizzle column deprecation** — follow a four-phase process:
   - **Phase 1 (MINOR):** Add new column alongside old. Backfill existing data.
   - **Phase 2:** Update all queries to read from new column. Write to both columns.
   - **Phase 3:** Stop writing to old column. Mark `@deprecated` in schema.
   - **Phase 4 (MAJOR):** Drop old column via migration.

10. **Docker compose deprecation** — when changing a service name or port, keep the old name as an alias or add a prominent comment with the migration timeline and the command to update.

## Examples

### Bad — silently remove a route

```typescript
// server/src/modules/reviews/routes.ts
// ❌ Route deleted — consumers get 404 with no warning
- app.get('/reviews/:id/findings', handler);
```

### Good — deprecate with headers and logging

```typescript
const deprecate = (replacement: string, sunset: string) => ({
  onSend: async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Deprecation', 'true');
    reply.header('Sunset', sunset);
    reply.header('Link', `<${replacement}>; rel="successor-version"`);
  },
  preHandler: async (req: FastifyRequest) => {
    req.log.warn({ replacement, sunset }, 'Deprecated endpoint called');
  },
});

app.get('/reviews/:id/findings',
  deprecate('/v2/reviews/:id/findings', 'Wed, 01 Oct 2026 00:00:00 GMT'),
  async (req) => service.findings(req.params.id),
);
```

### Bad — remove Zod field without deprecation

```typescript
// ❌ Field gone — client code breaks immediately
export const Skill = z.object({
  id: z.string().uuid(),
  name: z.string(),
  // type was removed
});
```

### Good — deprecate field, add replacement

```typescript
export const Skill = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: SkillType.optional().describe('DEPRECATED: use category instead'),
  category: SkillCategory, // new field
});
```

## Severity Mapping

| Severity | Criteria |
|----------|----------|
| **CRITICAL** | Public API/route/type/column removed without any deprecation notice |
| **WARNING** | Deprecated without migration guide, missing `Sunset` header, no log warning |
| **SUGGESTION** | Internal function removed without `@deprecated` phase, deprecation period shorter than 30 days |

## Exceptions

1. **Security vulnerabilities** — immediate removal is acceptable when keeping the code poses an active security risk. Document the rationale in CHANGELOG.
2. **Internal helpers** — functions with a single caller in the same module can be removed directly.
3. **Pre-release / alpha features** — features explicitly documented as unstable (e.g., `// @unstable` comment or behind a feature flag).
4. **Test utilities and fixtures** — test-only code is not a public contract.
