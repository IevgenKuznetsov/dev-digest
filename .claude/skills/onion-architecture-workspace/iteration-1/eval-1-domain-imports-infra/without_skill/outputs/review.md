# Architecture Review: Notification Module

## Summary

The notification module consists of two files:
- `modules/notification/domain/NotificationService.ts` — placed in a `domain/` directory
- `modules/notification/routes.ts` — the HTTP layer

On the surface the structure looks reasonable, but there is a critical layering violation in `NotificationService.ts` that undermines the intent of a domain layer entirely.

---

## Critical Issues

### 1. Domain Layer Directly Imports Infrastructure (Drizzle + DB Connection)

**File:** `modules/notification/domain/NotificationService.ts`, lines 1–3

```ts
import { eq, and } from 'drizzle-orm';
import { db } from '../../../db';
import { notifications } from '../../../db/schema';
```

**Violation:** In a properly layered architecture (Onion / Clean / Hexagonal), the domain layer must have zero knowledge of how data is persisted. It should define interfaces (ports) that infrastructure implementations fulfill. Here, `NotificationService` — named and located as a domain service — reaches directly into:

- The live Drizzle ORM client (`db`)
- The concrete DB schema table (`notifications`)
- Drizzle query builder utilities (`eq`, `and`)

This collapses the domain and infrastructure layers into a single class, making it impossible to:
- Unit-test `NotificationService` without a real (or mocked) database connection
- Swap the persistence mechanism (e.g., to an in-memory store for tests, or a different DB)
- Reason about business rules independently of storage details

**Fix:** Extract a `INotificationRepository` interface in the domain layer and move all Drizzle-specific code into an infrastructure class (e.g., `DrizzleNotificationRepository`). Inject the repository into `NotificationService` via constructor.

```ts
// domain/INotificationRepository.ts
export interface INotificationRepository {
  findUnreadByUser(userId: string): Promise<Notification[]>;
  countUnreadByUser(userId: string): Promise<number>;
  markRead(notificationId: string, userId: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
  create(userId: string, title: string, body: string): Promise<string>;
  deleteOldRead(userId: string, olderThanDays: number): Promise<number>;
}

// domain/NotificationService.ts
export class NotificationService {
  constructor(private readonly repo: INotificationRepository) {}

  async getUnread(userId: string): Promise<Notification[]> {
    return this.repo.findUnreadByUser(userId);
  }
  // ... delegate remaining methods
}

// infrastructure/DrizzleNotificationRepository.ts
import { eq, and } from 'drizzle-orm';
import { db } from '../../../db';
import { notifications } from '../../../db/schema';
import { INotificationRepository } from '../domain/INotificationRepository';

export class DrizzleNotificationRepository implements INotificationRepository {
  // ... all Drizzle queries live here
}
```

---

### 2. `deleteOld` Does Not Apply the `olderThanDays` Cutoff in the Query

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

**Bug / Logic Error:** The `cutoff` date is computed but never used in the `.where()` clause. The query deletes **all** read notifications for the user regardless of age, not just those older than `olderThanDays`. The method signature and surrounding code imply a date filter, but it is silently dropped.

This is both a correctness bug and a symptom of the layering problem: business rules (age-based retention) are buried inside a method that is also doing raw DB operations, making the logic easy to overlook.

**Fix:** Add a `lt` (less-than) predicate on `notifications.createdAt`:

```ts
.where(and(
  eq(notifications.userId, userId),
  eq(notifications.read, true),
  lt(notifications.createdAt, cutoff)   // apply the cutoff
))
```

---

## Moderate Issues

### 3. Module-Level Singleton Service in Routes

**File:** `modules/notification/routes.ts`, line 5

```ts
const service = new NotificationService();
```

`NotificationService` is instantiated as a module-level singleton with no way to inject dependencies (because the current implementation takes no constructor arguments). Once the repository abstraction is introduced (see Issue 1), this must change to:

```ts
export async function notificationRoutes(app: FastifyInstance) {
  const repo = new DrizzleNotificationRepository();
  const service = new NotificationService(repo);
  // ...
}
```

Or, preferably, wire dependencies through a DI container or Fastify's `decorate`/plugin system so that tests can substitute the repository.

### 4. Untyped `req.user` Access

**File:** `modules/notification/routes.ts`, lines 13, 20, 26, 32, 39

```ts
const userId = (req.user as any).id;
```

Casting `req.user` to `any` on every handler bypasses TypeScript's type safety. Fastify supports augmenting `FastifyRequest` via declaration merging:

```ts
// types/fastify.d.ts
import 'fastify';
declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; /* other fields */ };
  }
}
```

Once the type is declared, `req.user.id` is safe without casts and errors surface at compile time if the auth middleware is absent or changes shape.

### 5. `markReadSchema` Is Declared but Never Used

**File:** `modules/notification/routes.ts`, lines 7–9

```ts
const markReadSchema = z.object({
  notificationId: z.string().uuid(),
});
```

This schema is defined but never applied to any route. The `POST /notifications/:id/read` handler reads the `id` from `req.params` without validation. The dead code suggests an incomplete implementation. Either apply the schema or remove it.

---

## Minor Issues

### 6. `getUnreadCount` Uses a Full Row Fetch Instead of `count()`

**File:** `modules/notification/domain/NotificationService.ts`, lines 24–29

```ts
const rows = await db
  .select({ id: notifications.id })
  .from(notifications)
  .where(...);
return rows.length;
```

Fetching all matching row IDs and counting them in JavaScript is wasteful compared to a `SELECT COUNT(*)` pushed to the database. For large notification sets this degrades linearly. Use Drizzle's `count()` aggregate:

```ts
import { count } from 'drizzle-orm';
const [{ value }] = await db
  .select({ value: count() })
  .from(notifications)
  .where(...);
return value;
```

---

## Summary Table

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| 1 | Critical | `domain/NotificationService.ts` | Domain layer directly imports Drizzle ORM and DB — no repository abstraction |
| 2 | Critical | `domain/NotificationService.ts:54-62` | `deleteOld` cutoff date computed but never applied in query |
| 3 | Moderate | `routes.ts:5` | Module-level singleton prevents DI and testing |
| 4 | Moderate | `routes.ts` (all handlers) | `req.user as any` suppresses type safety |
| 5 | Moderate | `routes.ts:7-9` | `markReadSchema` declared but never applied or used |
| 6 | Minor | `domain/NotificationService.ts:24-29` | Count via full row fetch instead of SQL `COUNT()` |

---

## Recommended Layering Structure

```
modules/notification/
  domain/
    Notification.ts              # Entity / value object types
    INotificationRepository.ts   # Port (interface)
    NotificationService.ts       # Domain service — depends only on INotificationRepository
  infrastructure/
    DrizzleNotificationRepository.ts   # Adapter — implements INotificationRepository
  routes.ts                      # HTTP layer — wires infrastructure → domain → HTTP
```

The dependency rule: every arrow must point inward. `routes.ts` → `NotificationService` (domain) → `INotificationRepository` (domain). `DrizzleNotificationRepository` (infrastructure) → `INotificationRepository` (domain). The domain never references infrastructure.
