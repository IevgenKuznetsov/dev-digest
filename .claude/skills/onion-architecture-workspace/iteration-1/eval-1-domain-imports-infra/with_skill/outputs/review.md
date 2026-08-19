# Onion Architecture Review: Notification Module

**Reviewed by:** Architecture Reviewer (onion-architecture skill)
**Files reviewed:**
- `modules/notification/domain/NotificationService.ts`
- `modules/notification/routes.ts`

---

## Summary

The notification module contains **two critical layer dependency violations**. The most severe is in `NotificationService.ts`, which lives in the `domain/` folder but imports and directly uses Drizzle ORM infrastructure. The second violation is in `routes.ts`, which instantiates the service concretely (bypassing dependency injection) and omits a proper application layer. Neither file is release-ready as written.

---

## Violation 1: Domain Layer Imports Infrastructure (CRITICAL)

**File:** `modules/notification/domain/NotificationService.ts`
**Lines:** 1–3

```typescript
import { eq, and } from 'drizzle-orm';
import { db } from '../../../db';
import { notifications } from '../../../db/schema';
```

### What the rule says

The domain layer is the innermost ring of the onion. It must have **zero external dependencies** — no Drizzle, no Fastify, no npm packages. From `dependency-rule.md`:

> "Domain (`domain/`, `helpers.ts`, `constants.ts`) MUST NOT import from: `drizzle-orm`, `fastify`, `../../adapters/`, any npm package."

From `anti-patterns.md` (Anti-Pattern #1, "Leaking Infrastructure into Domain"):

> "Domain files import from infrastructure packages. Fix: Domain code uses only pure TypeScript. Move infrastructure-dependent logic to the infrastructure or application layer."

### Why this is a problem

`NotificationService` is physically located in `domain/` but is behaviorally an infrastructure class — it directly queries the database. This collapse of two layers into one destroys the key property onion architecture exists to provide: the domain is no longer testable without a live database, and any schema change (column rename, type change, added nullable) forces changes to the "domain" file.

Concretely:
- `eq`, `and` from `drizzle-orm` are Drizzle query builder helpers — infrastructure concepts.
- `db` is the Drizzle database connection singleton — a runtime infrastructure dependency.
- `notifications` from `../../../db/schema` is a Drizzle table descriptor — the ORM representation of the DB schema, not a domain concept.

Every method in `NotificationService` (`getUnread`, `getUnreadCount`, `markRead`, `markAllRead`, `create`, `deleteOld`) directly executes Drizzle queries. There is no domain logic here at all; the file is a repository masquerading as a domain service inside the domain folder.

### Fix

Split into three proper layers:

**1. Domain layer — define the interface (port) and entity type**

```typescript
// domain/ports.ts
import type { Notification } from './entities.js';

export interface NotificationRepository {
  findUnread(userId: string): Promise<Notification[]>;
  countUnread(userId: string): Promise<number>;
  markRead(notificationId: string, userId: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
  create(userId: string, title: string, body: string): Promise<string>;
  deleteReadOlderThan(userId: string, cutoff: Date): Promise<number>;
}

// domain/entities.ts
export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
}
```

**2. Infrastructure layer — implement the repository with Drizzle**

```typescript
// infrastructure/NotificationRepository.ts
import { eq, and, lt } from 'drizzle-orm';
import { db } from '../../../db';
import { notifications } from '../../../db/schema';
import type { NotificationRepository } from '../domain/ports.js';
import type { Notification } from '../domain/entities.js';

export class DrizzleNotificationRepository implements NotificationRepository {
  async findUnread(userId: string): Promise<Notification[]> {
    return db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
      .orderBy(notifications.createdAt);
  }
  // ... other methods
}
```

**3. Application layer — orchestrate via the port**

```typescript
// service.ts
import type { NotificationRepository } from './domain/ports.js';

export class NotificationService {
  constructor(private readonly repo: NotificationRepository) {}

  async getUnread(userId: string) { return this.repo.findUnread(userId); }
  async getUnreadCount(userId: string) { return this.repo.countUnread(userId); }
  async markRead(notificationId: string, userId: string) {
    return this.repo.markRead(notificationId, userId);
  }
  async markAllRead(userId: string) { return this.repo.markAllRead(userId); }
  async create(userId: string, title: string, body: string) {
    return this.repo.create(userId, title, body);
  }
  async deleteOld(userId: string, olderThanDays: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    return this.repo.deleteReadOlderThan(userId, cutoff);
  }
}
```

---

## Violation 2: Presentation Layer Bypasses Dependency Injection (HIGH)

**File:** `modules/notification/routes.ts`
**Line:** 5

```typescript
const service = new NotificationService();
```

### What the rule says

From `anti-patterns.md` (Anti-Pattern #6, "Container as Service Locator") and the composition root principle in `dependency-rule.md`:

> "The composition root wires everything — `platform/container.ts` is the single place that binds concrete implementations to abstract interfaces."

From `dependency-rule.md`:

> "The service layer depends on `GitHubClient` (the interface), never on `OctokitGitHubClient` (the implementation). The Container resolves the concrete type at runtime."

### Why this is a problem

`routes.ts` calls `new NotificationService()` directly, hard-wiring the concrete class into the presentation layer. This has several consequences:

1. **No dependency injection:** The concrete implementation cannot be swapped. In tests, there is no way to substitute a mock repository — the route will always attempt to connect to a real database.
2. **Layer skip:** Even once `NotificationService` is properly placed in the application layer, routes should receive it via the Fastify `request.server` context or a container, not by constructing it directly.
3. **Bypasses the composition root:** `platform/container.ts` is the designated wiring point for the project. Creating service instances in route files circumvents this pattern and makes the dependency graph invisible.

Additionally, `routes.ts` imports directly from `'./domain/NotificationService'` — a presentation layer importing from the domain layer is itself a mild smell. The route should import from the application layer (`service.ts`), not from domain internals.

### Fix

Wire through the container and receive the service via injection:

```typescript
// routes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const markReadSchema = z.object({
  notificationId: z.string().uuid(),
});

export async function notificationRoutes(app: FastifyInstance) {
  // Service is injected from the container via Fastify decorator
  const service = app.container.notificationService();

  app.get('/notifications', async (req, reply) => {
    const userId = (req.user as any).id;
    const items = await service.getUnread(userId);
    return reply.send({ notifications: items });
  });
  // ... remaining handlers unchanged
}
```

And register in the composition root:

```typescript
// platform/container.ts
notificationService(): NotificationService {
  return new NotificationService(new DrizzleNotificationRepository());
}
```

---

## Violation 3: Missing Application Layer Abstraction for deleteOld Cutoff Logic

**File:** `modules/notification/domain/NotificationService.ts`
**Lines:** 54–57

```typescript
async deleteOld(userId: string, olderThanDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
```

### What the rule says

From `anti-patterns.md` (Anti-Pattern #3, "Fat Controllers / Fat Routes") and by extension any fat layer: date arithmetic deriving a business cutoff is application-layer orchestration logic, not infrastructure. But here it sits in a class that also executes the Drizzle delete query — blurring application and infrastructure concerns in the same method.

### Why this is a problem

This is a secondary issue that only becomes visible once the primary violation is fixed. When `NotificationService` is properly placed in the application layer and delegates to a `NotificationRepository` port, the `cutoff` computation belongs in the service (application layer), while the actual delete query belongs in the repository (infrastructure). The current code does both in one place.

The proposed fix in Violation 1 already addresses this correctly: `service.ts` computes the cutoff and passes a `Date` to `repo.deleteReadOlderThan(userId, cutoff)`.

---

## Additional Concern: Absent Request Validation on Routes

**File:** `modules/notification/routes.ts`

`markReadSchema` is defined but never used. The `DELETE /notifications/old` route reads `days` from query parameters without any validation:

```typescript
const days = Number((req.query as any).days) || 30;
```

This is not a layering violation but is a presentation-layer quality gap. Use the defined Zod schema (or expand it) and apply it with `{ schema: { querystring: ... } }` on the route definition. From the skill's quick reference: "Presentation — Zod request schemas" is an explicit responsibility of this layer.

---

## PR Review Checklist Result

| Check | Result |
|---|---|
| No `drizzle-orm` imports in domain files | FAIL — `NotificationService.ts` imports `eq`, `and` from `drizzle-orm` |
| No `$inferSelect` types used outside repository files | PASS (not present) |
| Routes are thin (validate, context, delegate, respond) | PARTIAL — routes delegate correctly but instantiate the service directly |
| Services throw domain errors, not HTTP errors | N/A — no error handling present |
| No cross-module internal imports | PASS |
| Container not passed into domain services | N/A — no container used at all (direct construction) |
| Repository methods return domain entities | FAIL — there is no repository layer; domain returns raw DB rows |
| New interfaces defined in inner layers, implementations in outer layers | FAIL — no interfaces defined; single class spans all layers |

---

## Recommended Remediation Order

1. **Create `domain/entities.ts`** — extract the `Notification` interface with no imports.
2. **Create `domain/ports.ts`** — define `NotificationRepository` interface with domain-typed method signatures.
3. **Create `infrastructure/NotificationRepository.ts`** — move all Drizzle code here, implementing the port.
4. **Rename and fix `domain/NotificationService.ts` → `service.ts`** — rewrite to receive `NotificationRepository` via constructor injection, keep only orchestration logic.
5. **Update `routes.ts`** — remove `new NotificationService()`, receive service from container/decorator, fix unused schema and unvalidated query params.
6. **Register in composition root** — wire `DrizzleNotificationRepository` to `NotificationRepository` port in `platform/container.ts`.
