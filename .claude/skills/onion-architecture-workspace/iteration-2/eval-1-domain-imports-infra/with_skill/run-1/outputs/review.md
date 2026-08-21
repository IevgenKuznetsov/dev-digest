# Architectural Review: Notification Module

## Executive Summary

The notification module contains **three critical violations** of onion architecture principles. The file named `domain/NotificationService.ts` is, in reality, an infrastructure-layer repository masquerading as a domain service. The `routes.ts` file instantiates that class directly at module scope, bypassing the composition root entirely. There is no true domain layer, no application layer, and no infrastructure boundary. The module needs to be split into three properly separated layers.

---

## Violation 1: Domain File Contains Exclusively Infrastructure Code

**File:** `modules/notification/domain/NotificationService.ts`

**Severity: CRITICAL — Dependency Rule Violation**

The file lives under `domain/` but imports directly from infrastructure packages:

```typescript
import { eq, and } from 'drizzle-orm';   // infrastructure package
import { db } from '../../../db';          // infrastructure: singleton DB connection
import { notifications } from '../../../db/schema';  // infrastructure: Drizzle schema table
```

According to the dependency rule, the domain layer must have **zero external dependencies**. Importing `drizzle-orm`, a raw `db` singleton, or a Drizzle schema table object in a domain file is a direct inversion of the dependency rule: the innermost layer is now coupled to the outermost concerns.

**There is no domain logic in this file at all.** Every method is a raw Drizzle query:

- `getUnread` — `.select().from(notifications).where(...)` — pure persistence
- `getUnreadCount` — `.select({ id }).from(notifications).where(...)` — pure persistence
- `markRead` — `.update(notifications).set(...)` — pure persistence
- `markAllRead` — `.update(notifications).set(...)` — pure persistence
- `create` — `.insert(notifications).values(...)` — pure persistence
- `deleteOld` — `.delete(notifications).where(...)` — pure persistence

What is named `NotificationService` is, in substance, a **Drizzle repository** — it belongs in the infrastructure layer, not the domain layer.

Additionally, the `Notification` interface is defined in the same file. An interface that is a plain data shape (entity type) belongs in the domain layer, but here it is co-located with infrastructure code that imports Drizzle. This bundles domain and infrastructure concerns into a single file, making the layer boundary impossible to enforce.

---

## Violation 2: Missing Port — No Repository Interface in the Domain

**Severity: CRITICAL — Port/Adapter Pattern Not Applied**

There is no port (repository interface) defined anywhere in the module. In onion architecture, the domain layer defines *what* it needs from persistence as an interface (a **port**), and the infrastructure layer provides the concrete implementation (an **adapter**).

The file `domain/ports.ts` does not exist. It should exist and should define:

```typescript
// domain/ports.ts
import type { Notification } from './entities.js';

export interface NotificationRepository {
  getUnread(userId: string): Promise<Notification[]>;
  getUnreadCount(userId: string): Promise<number>;
  markRead(notificationId: string, userId: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
  create(userId: string, title: string, body: string): Promise<string>;
  deleteOld(userId: string, olderThanDays: number): Promise<number>;
}
```

Without this port, the application layer (the service) has no way to depend on an abstraction. It would be forced to depend directly on the Drizzle implementation, which propagates the infrastructure dependency inward — which is exactly what has happened here.

---

## Violation 3: Composition Root Bypassed — `new NotificationService()` at Module Scope

**File:** `modules/notification/routes.ts`, line 5

```typescript
const service = new NotificationService();
```

**Severity: CRITICAL — Composition Root Violation**

This single line is the site of two intertwined problems:

**3a. Ad-hoc construction outside the composition root.**
The composition root in this project is `platform/container.ts`. It is the **only** file that is permitted to construct concrete implementations and wire them to their interfaces. By calling `new NotificationService()` in `routes.ts`, the routes file becomes its own mini-composition root. This breaks the pattern in two ways:

1. There is now no single place to swap the implementation (e.g., for a different database, for testing, or for a future event-sourced implementation). Any test that imports `routes.ts` will trigger real database calls against the module-scoped singleton.
2. The constructed object is a module-level singleton whose lifecycle is tied to module load time, not to the application's startup sequence. This makes initialization order unpredictable and makes it impossible to inject a mock or a different adapter without monkey-patching module internals.

**3b. Routes depend on a concrete implementation, not a port.**
Even if the construction were moved to the Container, `routes.ts` currently imports from `./domain/NotificationService` — a concrete class. Routes are in the presentation layer. Presentation should depend only on the application layer (a service class or use-case interface), never on a specific implementation. The route file should receive a service (application-layer object) through its Fastify plugin closure, injected from the Container.

The correct pattern:

```typescript
// routes.ts (Presentation layer)
export async function notificationRoutes(app: FastifyInstance, { service }: { service: NotificationService }) {
  // service is injected — no `new`, no import of any implementation
}
```

And in the composition root (`container.ts`), the service is wired:

```typescript
// container.ts
get notificationService(): NotificationService {
  this._notificationService ??= new NotificationAppService(
    new DrizzleNotificationRepository(this.db)
  );
  return this._notificationService;
}
```

---

## Required Remediation: Three-Layer Split

The module must be separated into three properly bounded layers. Below is the specific file structure required.

### Layer 1 — Domain (`modules/notification/domain/`)

**Files to create:**

- `domain/entities.ts` — The `Notification` interface (already partially defined; move it here, remove all Drizzle imports)
- `domain/ports.ts` — The `NotificationRepository` port interface (see definition above)

These files must have **zero imports** from `drizzle-orm`, `fastify`, `../../../db`, or any npm package. They may only import from each other and from pure TypeScript utility types.

### Layer 2 — Application (`modules/notification/service.ts`)

**File to create:**

- `service.ts` — `NotificationAppService` class (the current `NotificationService` name can be reused here if desired, but the class must change)

This class receives a `NotificationRepository` port in its constructor (not the Drizzle implementation — the interface defined in `domain/ports.ts`). Its methods orchestrate use cases. It must not import from `drizzle-orm`, `../../../db`, or `../../../db/schema`. Example:

```typescript
// service.ts (Application layer)
import type { NotificationRepository } from './domain/ports.js';

export class NotificationService {
  constructor(private repo: NotificationRepository) {}

  async getUnread(userId: string) {
    return this.repo.getUnread(userId);
  }
  // ... other use cases
}
```

### Layer 3 — Infrastructure (`modules/notification/infrastructure/repository.ts`)

**File to create:**

- `infrastructure/repository.ts` — `DrizzleNotificationRepository` class

This class `implements NotificationRepository` (the port), imports from `drizzle-orm` and `../../../db/schema`, accepts a `Db` instance via constructor injection, and returns domain entities (not raw Drizzle row types). All six Drizzle query blocks from the current `NotificationService` move here.

```typescript
// infrastructure/repository.ts (Infrastructure layer)
import { eq, and } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { NotificationRepository } from '../domain/ports.js';
import type { Notification } from '../domain/entities.js';

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private db: Db) {}
  // ... implement all methods
}
```

---

## Composition Root Wiring (`platform/container.ts`)

After the split, `container.ts` is updated to wire the adapter to the port and construct the service:

```typescript
get notificationService(): NotificationService {
  this._notificationService ??= new NotificationService(
    new DrizzleNotificationRepository(this.db)
  );
  return this._notificationService;
}
```

The routes plugin receives the service via Fastify plugin options:

```typescript
app.register(notificationRoutes, { service: container.notificationService });
```

---

## Summary Table

| Issue | Location | Anti-Pattern | Severity |
|---|---|---|---|
| Domain file imports `drizzle-orm`, `db`, schema | `domain/NotificationService.ts` | Leaking Infrastructure into Domain | CRITICAL |
| No repository port interface exists | `domain/` (missing `ports.ts`) | No Port/Adapter boundary | CRITICAL |
| All logic is raw Drizzle queries; zero domain logic | `domain/NotificationService.ts` | Infrastructure masquerading as Domain | CRITICAL |
| `new NotificationService()` at module scope in routes | `routes.ts` line 5 | Composition Root Bypass | CRITICAL |
| Routes import concrete implementation, not interface | `routes.ts` line 3 | Presentation depends on Infrastructure | HIGH |

---

## Quick Checklist

- [ ] Create `domain/entities.ts` with `Notification` interface (no external imports)
- [ ] Create `domain/ports.ts` with `NotificationRepository` interface
- [ ] Create `infrastructure/repository.ts` with `DrizzleNotificationRepository implements NotificationRepository`
- [ ] Create/rename `service.ts` with `NotificationService` that accepts `NotificationRepository` in constructor
- [ ] Delete `domain/NotificationService.ts`
- [ ] Remove module-scope `new NotificationService()` from `routes.ts`
- [ ] Wire concrete classes in `platform/container.ts` only
- [ ] Pass service to routes via plugin options, not via direct import
