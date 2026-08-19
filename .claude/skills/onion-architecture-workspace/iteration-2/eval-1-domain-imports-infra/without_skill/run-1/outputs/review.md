# Architecture Review: Notification Module

**Date:** 2026-08-19
**Reviewer:** Architecture Reviewer (automated)
**Files Reviewed:**
- `modules/notification/domain/NotificationService.ts`
- `modules/notification/routes.ts`

---

## Executive Summary

The notification module contains a **critical Onion Architecture violation**: the domain layer directly imports infrastructure concerns (Drizzle ORM, the database connection, and the DB schema). This is the foundational anti-pattern in layered architectures — the inner ring importing the outer ring. The routes layer has additional issues but they are secondary to this core structural problem.

**Verdict: BLOCK RELEASE.** The domain layer must be purified before this code ships.

---

## Architectural Background

Onion Architecture (Evans/Palermo) mandates a strict dependency rule:

```
[Routes / HTTP Adapters]  →  [Application Services]  →  [Domain]  →  (nothing)
         ↓                           ↓
  [Infrastructure]  ←←←←←←←←←←←←←←←←←←←←←
```

The **Domain layer** is the innermost ring. It must have **zero knowledge** of how data is stored, what ORM is used, or how the database is structured. All I/O flows inward via **repository interfaces** defined in the domain and implemented in infrastructure.

---

## Findings

### CRITICAL — Finding 1: Domain Layer Imports Infrastructure Directly

**File:** `modules/notification/domain/NotificationService.ts`, lines 1–3

```ts
import { eq, and } from 'drizzle-orm';
import { db } from '../../../db';
import { notifications } from '../../../db/schema';
```

**Violation:** The class named `NotificationService` resides inside the `domain/` folder, yet it directly imports:
- `drizzle-orm` — a specific ORM library (infrastructure technology)
- `../../../db` — the concrete database connection singleton (infrastructure instantiation)
- `../../../db/schema` — the Drizzle table schema definition (infrastructure artifact)

This is a direct inversion of the dependency rule. The domain layer now **depends on infrastructure**, meaning:
1. You cannot unit-test domain logic without a live database (or extensive mocking of Drizzle internals).
2. Swapping the database engine (e.g., from PostgreSQL to another store) requires modifying domain code.
3. The domain leaks Drizzle-specific constructs (`eq`, `and`, query builder chains) into business logic.

**Correct pattern:** `NotificationService` should depend on an abstract `INotificationRepository` interface defined in the domain. The Drizzle implementation lives in an `infrastructure/` or `persistence/` folder.

**Files that should exist but do not:**
- `modules/notification/domain/INotificationRepository.ts` — repository port interface
- `modules/notification/infrastructure/DrizzleNotificationRepository.ts` — concrete adapter
- `modules/notification/infrastructure/NotificationMapper.ts` — maps DB rows ↔ domain entities

---

### CRITICAL — Finding 2: `NotificationService` Is Actually a Repository, Not a Service

**File:** `modules/notification/domain/NotificationService.ts`, full file

Every method in `NotificationService` is a direct database operation: `select`, `insert`, `update`, `delete`. There is no business logic — no invariants enforced, no domain events raised, no rules about when a notification can be deleted or what constitutes a valid notification.

**Violation type:** Layer conflation. What is labeled a "Service" is actually a **Repository** (data access object). True domain services orchestrate domain entities and enforce business rules. Repositories handle persistence.

**Consequence:** There is no room in this architecture to add business logic later without further coupling. If a rule like "a user can only mark notifications as read if they own them" needs enforcement at the domain level, there is nowhere clean to put it.

**Correct pattern:**
- `INotificationRepository` (domain interface): declares `findUnread(userId)`, `save(notification)`, `markRead(id, userId)`, etc.
- `NotificationService` (domain service, if needed): orchestrates domain entities using the repository interface — or this collapses into an application-layer use case.
- `DrizzleNotificationRepository` (infrastructure): implements the interface using Drizzle.

---

### CRITICAL — Finding 3: `deleteOld` Has a Logic Bug Masked by Layer Violation

**File:** `modules/notification/domain/NotificationService.ts`, lines 54–62

```ts
async deleteOld(userId: string, olderThanDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const deleted = await db
    .delete(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, true)))
    .returning({ id: notifications.id });
  return deleted.length;
}
```

The `cutoff` date is computed but **never used in the query predicate**. The `.where()` clause only filters by `userId` and `read = true` — it deletes ALL read notifications for the user regardless of age. The `olderThanDays` parameter is dead code.

This bug is architectural as well as functional: because the data access is embedded in the domain class rather than isolated in a repository, the query predicate is not independently testable. A repository interface would force the caller to pass a `cutoff: Date` parameter, making the contract explicit and auditable.

---

### HIGH — Finding 4: Module-Level Service Singleton in Routes

**File:** `modules/notification/routes.ts`, line 5

```ts
const service = new NotificationService();
```

The service is instantiated at module load time as a top-level constant. This pattern:
1. Makes dependency injection impossible — you cannot substitute a mock or alternative implementation without monkey-patching.
2. Couples the route registration function to a specific concrete class.
3. Prevents the service from receiving constructor-injected dependencies (e.g., a repository instance).

**Correct pattern:** Use Fastify's `decorate`/`decorateRequest` plugin system or pass dependencies through the `FastifyInstance` via a DI container. Alternatively, accept the service as a parameter to `notificationRoutes(app, { service })`.

---

### HIGH — Finding 5: Authentication Bypasses Type System

**File:** `modules/notification/routes.ts`, lines 13, 20, 27, 32, 38

```ts
const userId = (req.user as any).id;
```

This pattern appears in every route handler. `as any` silences TypeScript entirely, meaning:
- If `req.user` is `undefined` (unauthenticated request), this crashes at runtime with `Cannot read properties of undefined`.
- There is no compile-time guarantee that the user object has an `id` field.
- There is no visible authentication guard — it is unclear whether a Fastify `preHandler` hook enforces auth on these routes.

**Correct pattern:**
1. Augment the Fastify type declarations: `declare module 'fastify' { interface FastifyRequest { user: AuthenticatedUser } }`.
2. Register a typed `preHandler` authentication hook explicitly on these routes or their enclosing plugin scope.
3. Return `401 Unauthorized` explicitly when auth fails, not a 500 crash.

---

### MEDIUM — Finding 6: No Input Validation on Route Parameters

**File:** `modules/notification/routes.ts`, lines 25–29 and 38–41

The `POST /notifications/:id/read` route casts `req.params` with `as { id: string }` rather than parsing through the defined `markReadSchema`. Notably, `markReadSchema` is defined (line 7–9) but never applied to any route. The schema is dead code.

The `DELETE /notifications/old` route reads `req.query.days` with `as any` and coerces with `Number(...)`, with no bounds checking. A caller passing `days=0` or `days=-1` would delete nothing or behave incorrectly; `days=NaN` falls back to 30 but silently.

**Correct pattern:** Use Fastify's built-in JSON Schema validation (`schema: { params: ..., querystring: ... }`) or explicitly call `markReadSchema.parse(req.params)` and handle `ZodError`. Apply the existing `markReadSchema` or move validation to Zod `.parse()` in the handler.

---

### MEDIUM — Finding 7: Missing Response Schemas

**File:** `modules/notification/routes.ts`, all routes

No Fastify route has a declared `schema.response`. This means:
- Fastify cannot serialize responses with its fast-json-stringify path (performance regression).
- The response contract is not documented or enforced — fields can leak or drift.
- OpenAPI generation (if used) will produce no documentation for these endpoints.

---

### LOW — Finding 8: Notification Domain Entity Not a True Entity

**File:** `modules/notification/domain/NotificationService.ts`, lines 5–13

The `Notification` interface is an anemic data transfer object — it mirrors the DB schema column-for-column. A proper domain entity would:
- Encapsulate invariants (e.g., `markAsRead()` method that validates the transition).
- Be constructed via a factory or constructor that enforces required fields.
- Not expose raw DB-generated values like `readAt: Date | null` as public mutable fields.

This is a lower-priority concern but signals the module was designed database-first rather than domain-first.

---

## Prioritized Remediation Plan

### Priority 1 — Fix the Layer Inversion (Blocking)

1. Create `modules/notification/domain/INotificationRepository.ts`:
   ```ts
   export interface INotificationRepository {
     findUnread(userId: string): Promise<Notification[]>;
     countUnread(userId: string): Promise<number>;
     markRead(notificationId: string, userId: string): Promise<void>;
     markAllRead(userId: string): Promise<void>;
     create(userId: string, title: string, body: string): Promise<string>;
     deleteReadOlderThan(userId: string, cutoff: Date): Promise<number>;
   }
   ```

2. Create `modules/notification/infrastructure/DrizzleNotificationRepository.ts` implementing `INotificationRepository` with all current Drizzle logic.

3. Rewrite `NotificationService` to accept `INotificationRepository` via constructor injection. Remove all Drizzle imports from `domain/`.

4. Fix the `deleteOld` bug: pass `cutoff` to the repository method and include it in the WHERE clause (`lt(notifications.createdAt, cutoff)`).

### Priority 2 — Fix the `deleteOld` Bug (Blocking — Data Integrity)

Even before the refactor, patch the query predicate immediately to include the cutoff date filter. This is a functional bug in production code.

### Priority 3 — Fix Dependency Injection in Routes (High)

Refactor `notificationRoutes` to accept dependencies rather than instantiate them:
```ts
export async function notificationRoutes(
  app: FastifyInstance,
  opts: { service: INotificationService }
) { ... }
```
Register the concrete implementation at the module registration site in `server/src/modules/index.ts`.

### Priority 4 — Fix Authentication Type Safety (High)

Augment FastifyRequest types, add an explicit `preHandler` auth hook, and handle unauthenticated requests with proper 401 responses.

### Priority 5 — Apply Input Validation (Medium)

Wire `markReadSchema` to the actual route or replace with Fastify JSON schema. Add bounds validation for `days` query parameter.

### Priority 6 — Add Response Schemas (Medium)

Define Fastify `schema.response` objects for all five routes.

---

## Summary Table

| # | Severity | Finding | File | Action |
|---|----------|---------|------|--------|
| 1 | CRITICAL | Domain imports infrastructure (Drizzle, db, schema) | `domain/NotificationService.ts:1-3` | Extract `INotificationRepository` interface; move Drizzle code to infrastructure layer |
| 2 | CRITICAL | "Service" is actually a repository with no domain logic | `domain/NotificationService.ts` | Rename/restructure; separate repository from service |
| 3 | CRITICAL | `deleteOld` ignores `cutoff` — deletes ALL read notifications | `domain/NotificationService.ts:54-62` | Fix WHERE predicate to include date filter |
| 4 | HIGH | Module-level singleton prevents DI and testing | `routes.ts:5` | Inject service via function parameter or Fastify DI |
| 5 | HIGH | `req.user as any` — no type safety, no explicit auth guard | `routes.ts:13,20,27,32,38` | Augment types, add preHandler auth hook |
| 6 | MEDIUM | `markReadSchema` defined but never used; `as any` casts on params | `routes.ts:7-9,25-29,38-41` | Apply schema parsing or Fastify JSON schema |
| 7 | MEDIUM | No response schemas declared | `routes.ts` | Add `schema.response` to all routes |
| 8 | LOW | `Notification` interface is anemic DB mirror, not a domain entity | `domain/NotificationService.ts:5-13` | Enrich entity with behavior; build domain-first |
