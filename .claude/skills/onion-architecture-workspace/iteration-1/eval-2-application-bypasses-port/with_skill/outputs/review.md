# Architecture Review: Analytics Module (Pre-Merge)

**Reviewer:** Onion Architecture Skill (v1.0.0)
**Date:** 2026-08-19
**Scope:** `modules/analytics/` — `domain/types.ts`, `repository.ts`, `service.ts`, `routes.ts`

---

## Summary

The analytics module has structural bones in the right place (a `domain/` folder, a repository file, a service, and routes) but has four concrete onion-architecture violations that will make the module progressively harder to test and maintain. Two of them are **critical** (service locator bypass + presentation layer reaching into infrastructure directly); the other two are **moderate** (business logic migrated into infrastructure, missing port interface). None are exotic — they are the classic "we built it fast" patterns this review exists to catch.

---

## Violation 1 — Application Layer Bypasses the Port (CRITICAL)

**Where:** `service.ts` lines 1 and 8

```typescript
// service.ts
import { AnalyticsRepository } from './repository';   // imports the CONCRETE class

export class AnalyticsService {
  private repo: AnalyticsRepository;
  constructor() {
    this.repo = new AnalyticsRepository();             // constructs it directly
  }
}
```

**Why it violates onion architecture:**
The Application layer (`service.ts`) must depend on an **interface** (port) defined in the Domain layer, not on a concrete infrastructure class. Here the service both imports and instantiates `AnalyticsRepository` — the concrete Drizzle-backed class — which means:

1. The application layer has an outward dependency on the infrastructure layer, reversing the required dependency direction.
2. The service cannot be unit-tested without a real database; there is no seam to inject a mock.
3. Swapping the storage backend (e.g., replacing Drizzle with a different ORM, or adding a caching layer) requires editing the service, not just swapping an adapter.

**Fix:**

Step 1 — Define a port (interface) in the domain layer:

```typescript
// domain/ports.ts
import type { PageView, DashboardStats } from './types';

export interface AnalyticsPort {
  record(view: PageView): Promise<void>;
  getDashboardStats(fromDate: Date): Promise<DashboardStats>;
  getRecentViews(limit: number): Promise<PageView[]>;
}
```

Step 2 — Make the repository implement the port:

```typescript
// repository.ts
import type { AnalyticsPort } from './domain/ports';
export class AnalyticsRepository implements AnalyticsPort { ... }
```

Step 3 — Inject the port into the service (not the concrete class):

```typescript
// service.ts
import type { AnalyticsPort } from './domain/ports';

export class AnalyticsService {
  constructor(private repo: AnalyticsPort) {}
  // methods unchanged
}
```

Step 4 — Wire the concrete class in the composition root (`platform/container.ts`), not inside the service.

---

## Violation 2 — No-Arg Constructor Breaks DI / Makes Service Untestable (CRITICAL)

**Where:** `service.ts` line 7

```typescript
constructor() {
  this.repo = new AnalyticsRepository();
}
```

**Why it violates onion architecture:**
The composition root (`platform/container.ts`) is the only place that should construct concrete implementations and wire them to interfaces. When a service constructs its own collaborators, it bypasses the container entirely. This is the **service locator anti-pattern** — the service secretly creates its own infrastructure, making it impossible to:

- Inject a test double (no mock can be passed in)
- Intercept the construction for metrics, tracing, or caching
- Apply any container-level lifecycle management (e.g., sharing a DB connection pool)

This violation compounds Violation 1: even if a port interface were introduced, a no-arg constructor would still prevent injection.

**Fix:**
Require the port as a constructor argument (shown in the Violation 1 fix above). The container constructs `AnalyticsRepository` and passes it in:

```typescript
// platform/container.ts
get analyticsService(): AnalyticsService {
  return (this._analyticsService ??= new AnalyticsService(
    new AnalyticsRepository(this.db),
  ));
}
```

---

## Violation 3 — Presentation Layer Reaches Directly into Infrastructure (CRITICAL)

**Where:** `routes.ts` lines 3–7 and 18, 35–45

```typescript
// routes.ts
import { AnalyticsRepository } from './repository';  // infrastructure import in presentation
import { db } from '../../db';                        // raw DB handle in presentation
import { pageViews } from '../../db/schema';          // DB schema in presentation
import { desc } from 'drizzle-orm';                   // ORM import in presentation

export async function analyticsRoutes(app: FastifyInstance) {
  const service = new AnalyticsService();
  const repo = new AnalyticsRepository();             // second repo instance constructed here

  // /analytics/recent bypasses service entirely — uses repo directly
  app.get('/analytics/recent', async (req, reply) => {
    const events = await repo.getRecentViews(limit);
    return reply.send({ events });
  });

  // /analytics/live bypasses ALL layers — raw SQL query in a route handler
  app.get('/analytics/live', async (req, reply) => {
    const rows = await db
      .select()
      .from(pageViews)
      .orderBy(desc(pageViews.timestamp))
      .limit(10);
    return reply.send({ live: rows });
  });
}
```

**Why it violates onion architecture:**
The Presentation layer (`routes.ts`) must depend on the Application layer only. It must not import from infrastructure (`repository.ts`, `db/schema`, `drizzle-orm`) or bypass the service layer. Two routes do this:

- `/analytics/recent` skips the service and calls the repository directly. The application layer (the `getRecentActivity` use case on `AnalyticsService`) is simply ignored for this endpoint.
- `/analytics/live` skips every layer and embeds a raw Drizzle query in the route handler — putting infrastructure logic in the presentation layer.

Consequences:
- Any business rules (authorization checks, field filtering, rate limiting) that belong in the service will silently not apply to these two endpoints.
- DB queries are duplicated across layers; a schema change must be patched in multiple files.
- The route file is untestable without a real database.
- The import of `drizzle-orm` directly in a route is the clearest signal of a fat-route anti-pattern.

**Fix:**

Add `getLiveEvents` to `AnalyticsService` (and the corresponding method to `AnalyticsPort`):

```typescript
// domain/ports.ts — add:
getLiveEvents(limit: number): Promise<PageView[]>;

// service.ts — add:
async getLiveEvents(limit: number = 10): Promise<PageView[]> {
  return this.repo.getLiveEvents(limit);
}

// repository.ts — add:
async getLiveEvents(limit: number): Promise<PageView[]> {
  const rows = await db
    .select()
    .from(pageViews)
    .orderBy(desc(pageViews.timestamp))
    .limit(limit);
  return rows.map(toPageView);
}
```

Then thin down the routes to delegate everything to the service, receive it via injection (not `new`), and remove all infrastructure imports:

```typescript
// routes.ts (corrected)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AnalyticsService } from './service';

const trackSchema = z.object({ ... });

export async function analyticsRoutes(app: FastifyInstance, service: AnalyticsService) {
  app.post('/analytics/track', async (req, reply) => {
    const body = trackSchema.parse(req.body);
    const userId = (req.user as any)?.id ?? null;
    await service.trackView(body.path, body.sessionId, userId, body.durationMs, body.referrer ?? null);
    return reply.send({ ok: true });
  });

  app.get('/analytics/dashboard', async (req, reply) => {
    const days = Number((req.query as any).days) || 30;
    return reply.send(await service.getDashboard(days));
  });

  app.get('/analytics/recent', async (req, reply) => {
    const limit = Math.min(Number((req.query as any).limit) || 50, 200);
    return reply.send({ events: await service.getRecentActivity(limit) });
  });

  app.get('/analytics/live', async (req, reply) => {
    return reply.send({ live: await service.getLiveEvents(10) });
  });
}
```

---

## Violation 4 — Business Logic in the Infrastructure Layer (MODERATE)

**Where:** `repository.ts` lines 18–48 (`getDashboardStats`)

```typescript
// repository.ts
async getDashboardStats(fromDate: Date): Promise<DashboardStats> {
  const rows = await db.select().from(pageViews).where(...);

  // All of this is business logic, not data access:
  const totalViews = rows.length;
  const uniqueSessions = new Set(rows.map(r => r.sessionId)).size;
  const bounces = Object.values(sessionPageCounts).filter(c => c === 1).length;
  const bounceRate = uniqueSessions > 0 ? bounces / uniqueSessions : 0;
  const topPages = Object.entries(pathStats)
    .map(...)
    .sort(...)
    .slice(0, 10);
  ...
}
```

**Why it violates onion architecture:**
The repository's responsibility is data access: issue queries, map rows to domain objects, return them. The computation of `bounceRate`, the aggregation of `topPages`, the definition of what constitutes a "bounce" — these are business rules that belong in the Application layer (inside `AnalyticsService.getDashboard`) or, if they become complex enough, in a domain service. Placing them in the repository:

- Prevents reuse: a different use case that wants just the raw views cannot get them without triggering the full aggregation.
- Makes the business logic impossible to unit-test without database fixtures.
- Violates single-responsibility: the repository now knows about analytics business semantics, not just data storage.

**Fix:**
Split the repository into pure data access, and move aggregation into the service (or a domain service/helper):

```typescript
// repository.ts — data access only
async getViewsSince(fromDate: Date): Promise<PageView[]> {
  const rows = await db.select().from(pageViews).where(gte(pageViews.timestamp, fromDate));
  return rows.map(toPageView);
}

// service.ts — business computation
async getDashboard(days: number = 30): Promise<DashboardStats> {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  const views = await this.repo.getViewsSince(fromDate);
  return computeDashboardStats(views);  // pure function, easily unit-tested
}

// domain/stats.ts — pure domain function (no imports, no DB)
export function computeDashboardStats(views: PageView[]): DashboardStats { ... }
```

---

## Violation 5 — Missing Port Interface in Domain Layer (MODERATE)

**Related to Violation 1.** The `domain/` folder contains only `types.ts` with three data shapes (`PageView`, `DashboardStats`, `RetentionRow`). There is no port interface (e.g., `AnalyticsPort`) defining what the repository contract should look like. Without a port:

- The application layer has no stable contract to program against.
- There is nothing to implement mocks from in tests.
- The dependency inversion principle is structurally absent: no inner-layer interface exists for the outer layer to implement.

**Fix:** Add `domain/ports.ts` as shown in Violation 1's fix. This is the prerequisite for every other fix.

---

## Violation 6 — `AnalyticsRepository` Constructed Twice (MINOR)

**Where:** `routes.ts` lines 17–18

```typescript
const service = new AnalyticsService();  // internally constructs a repo
const repo = new AnalyticsRepository();  // constructs a second, separate repo instance
```

Two distinct repository instances are created: one inside `AnalyticsService` (via its no-arg constructor) and one directly in the route file. Any state that the repository might hold (connection references, caches) would be split across two independent objects. This is a consequence of Violations 1, 2, and 3 compounding — fixing those three violations eliminates this one automatically, since the container will manage exactly one instance.

---

## Quick Checklist Results

| Check | Result |
|---|---|
| No `drizzle-orm` or `fastify` imports in domain files | PASS — `domain/types.ts` is clean |
| No `$inferSelect` types used outside repository files | PASS — not present |
| Routes are thin (validate, context, delegate, respond) | FAIL — `/analytics/live` has raw Drizzle query; `/analytics/recent` calls repo directly |
| Services throw domain errors, not HTTP errors | PASS — no HTTP errors in service |
| No cross-module internal imports | PASS — analytics does not import from sibling modules |
| Container not passed into domain services | PASS — Container is not passed in; but the flip side is the service constructs its own deps |
| Repository methods return domain entities | PASS — `getRecentViews` returns `PageView[]` (domain type) |
| New interfaces defined in inner layers, implementations in outer layers | FAIL — no port interface exists; service depends on concrete class |

---

## Priority Fix Order

1. **Add `domain/ports.ts`** — prerequisite for everything else.
2. **Fix `service.ts`** — inject `AnalyticsPort` via constructor; remove internal `new AnalyticsRepository()`.
3. **Fix `routes.ts`** — remove all infrastructure imports; remove direct repo instantiation; add `getLiveEvents` delegation.
4. **Move dashboard aggregation** from `repository.ts` to `service.ts` / a domain helper function.
5. **Register in container** — add `analyticsService` getter in `platform/container.ts`.

None of these changes affect the public HTTP API surface. The `/analytics/track`, `/analytics/dashboard`, `/analytics/recent`, and `/analytics/live` endpoints will behave identically — they will simply be backed by a correctly layered implementation.
