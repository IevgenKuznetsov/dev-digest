# Architecture Review: Analytics Module (Pre-Merge)

**Reviewer:** Onion Architecture Skill  
**Date:** 2026-08-19  
**Scope:** `modules/analytics/` — domain/types.ts, repository.ts, service.ts, routes.ts

---

## Summary

The analytics module has a clean domain layer (`domain/types.ts`) but breaks down at every other layer. There are **four distinct violations** across the application, infrastructure, and presentation layers. None of these are minor style concerns — each one undermines testability, lifecycle management, or the separation of concerns that makes the onion architecture valuable.

---

## Violation 1: Multiple AnalyticsRepository Instances at Runtime

**Severity: HIGH**

**What the code does:**

```typescript
// service.ts
export class AnalyticsService {
  private repo: AnalyticsRepository;
  constructor() {
    this.repo = new AnalyticsRepository();  // Instance #1
  }
}

// routes.ts
export async function analyticsRoutes(app: FastifyInstance) {
  const service = new AnalyticsService();
  const repo = new AnalyticsRepository();  // Instance #2 (directly in routes)
  // ...
}
```

At runtime, `analyticsRoutes` creates **two separate `AnalyticsRepository` instances**: one inside `new AnalyticsService()` (which itself calls `new AnalyticsRepository()` in its constructor), and a second one created directly on the next line in the route file. The `/analytics/recent` route uses the second instance while `/analytics/dashboard` and `/analytics/track` use the one buried inside the service.

**Why this is a problem:**

1. **No shared lifecycle.** If `AnalyticsRepository` ever holds state (connection pool references, caches, in-flight request tracking), those two instances are completely independent. One could be in a different state than the other.

2. **Untestable.** Because the repository is constructed inside the service constructor, there is no injection point. Tests cannot swap in a mock repository. Any test of `AnalyticsService` will hit a real database — or fail trying.

3. **Violates the composition root principle.** The dependency-injection rules for this project are explicit: the `Container` (`platform/container.ts`) is the single place that constructs concrete implementations. Having two ad-hoc `new AnalyticsRepository()` calls in two different files is a service-locator anti-pattern distributed across the module.

4. **Silent behavioral divergence.** The `/analytics/recent` route calls `repo.getRecentViews(limit)` on the second repository instance, while the service calls the same method on the first. If the repository is ever refactored to have instance-level state, these two paths will behave differently with no indication why.

---

## Violation 2: getDashboardStats Belongs in the Application Layer, Not the Repository

**Severity: HIGH**

**What the code does:**

```typescript
// repository.ts
async getDashboardStats(fromDate: Date): Promise<DashboardStats> {
  const rows = await db.select().from(pageViews).where(gte(pageViews.timestamp, fromDate));

  const totalViews = rows.length;
  const uniqueSessions = new Set(rows.map(r => r.sessionId)).size;
  const uniqueUsers = new Set(rows.filter(r => r.userId).map(r => r.userId)).size;
  const avgDurationMs = totalViews > 0
    ? rows.reduce((sum, r) => sum + r.durationMs, 0) / totalViews
    : 0;

  const sessionPageCounts: Record<string, number> = {};
  rows.forEach(r => { sessionPageCounts[r.sessionId] = (sessionPageCounts[r.sessionId] || 0) + 1; });
  const bounces = Object.values(sessionPageCounts).filter(c => c === 1).length;
  const bounceRate = uniqueSessions > 0 ? bounces / uniqueSessions : 0;
  // ... topPages computation ...

  return { totalViews, uniqueSessions, uniqueUsers, avgDurationMs, bounceRate, topPages };
}
```

**What a repository is supposed to do:**

The infrastructure layer's repository has one job: translate between domain entities and the database. It fetches rows, maps them to domain types, and returns them. It does not aggregate, does not compute derived metrics, and does not apply business rules about what constitutes a "bounce."

**What getDashboardStats actually does:**

- Fetches all rows in a date range (legitimate infrastructure work)
- Counts totals, unique sets, averages (business aggregation — application layer)
- Computes bounce rate via session page-count logic (domain rule — what is a "bounce"?)
- Sorts and slices top-10 pages (presentation shaping)

This is four responsibilities collapsed into one infrastructure method. The "bounce" definition (a session with exactly one page view) is a business rule. If the product team changes the definition to "a session under 10 seconds," that change must be made inside the repository, which is the wrong place entirely.

**Where it belongs:**

- The repository should expose `getViewsSince(fromDate: Date): Promise<PageView[]>` — raw data retrieval only.
- `AnalyticsService.getDashboard()` should call that, then compute the aggregations using the domain types from `domain/types.ts`.
- The `DashboardStats` shape is already a domain type. The computation logic that produces it is application-layer orchestration, not infrastructure.

---

## Violation 3: Incorrect Constructor Injection Pattern in AnalyticsService

**Severity: HIGH**

**Current code:**

```typescript
export class AnalyticsService {
  private repo: AnalyticsRepository;

  constructor() {
    this.repo = new AnalyticsRepository();
  }
}
```

**The problem:**

The service constructs its own dependency. This makes the service the owner of its collaborator, which means:
- No substitution at test time (no mock repository)
- No lifecycle control from outside (the Container cannot manage the repository's lifetime)
- The service is coupled to the concrete `AnalyticsRepository` class, not an interface

**The correct pattern:**

```typescript
// service.ts
export class AnalyticsService {
  constructor(private readonly repo: IAnalyticsRepository) {}

  async getDashboard(days: number = 30): Promise<DashboardStats> {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    const views = await this.repo.getViewsSince(fromDate);
    return computeDashboardStats(views);  // pure function, easily tested
  }
}
```

The repository is injected via the constructor parameter. The type is the interface (`IAnalyticsRepository`), not the concrete class. The Container constructs the `DrizzleAnalyticsRepository` and passes it in. Tests construct the service with a stub or in-memory implementation.

This pattern is already documented and used throughout the project (see `platform/container.ts` with `GitHubClient`, `GitClient`, etc.).

---

## Violation 4: Missing Port Interface for the Repository

**Severity: HIGH**

**What is missing:**

There is no interface defining what the analytics module needs from its data store. The service directly references the concrete `AnalyticsRepository` class. This is an inward dependency on an outer layer — the application layer reaching into the infrastructure layer.

**The interface that should be introduced:**

**File:** `modules/analytics/domain/ports.ts`

```typescript
// domain/ports.ts
import type { PageView, DashboardStats } from './types.js';

export interface IAnalyticsRepository {
  record(view: PageView): Promise<void>;
  getViewsSince(fromDate: Date): Promise<PageView[]>;
  getRecentViews(limit: number): Promise<PageView[]>;
}
```

**Why this location:**

Per the onion architecture dependency rule, inner layers define interfaces; outer layers implement them. The domain layer (`domain/`) must define what it needs. The infrastructure layer (`repository.ts`) then `implements IAnalyticsRepository`. The service constructor receives `IAnalyticsRepository`, never the concrete class. The Container wires them together at startup.

Note that `getDashboardStats` disappears from the interface entirely, because the aggregation logic moves into the application layer (see Violation 2).

---

## Violation 5: /analytics/live Route — Direct Database Access in Presentation Layer

**Severity: HIGH**

**This is a distinct violation from /analytics/recent.**

```typescript
// routes.ts
app.get('/analytics/live', async (req, reply) => {
  const rows = await db
    .select()
    .from(pageViews)
    .orderBy(desc(pageViews.timestamp))
    .limit(10);
  return reply.send({ live: rows });
});
```

**Why this is distinct from /analytics/recent:**

The `/analytics/recent` route calls `repo.getRecentViews(limit)` — it is bypassing the service to call the repository directly. That is a layer-skip violation (presentation skipping application).

The `/analytics/live` route goes further: it bypasses **both** the service **and** the repository. It imports `db` and `pageViews` from infrastructure packages directly into the route file. This is the presentation layer reaching all the way through to the database.

**Imports that should not appear in routes.ts:**

```typescript
import { AnalyticsRepository } from './repository';  // bypasses service
import { db } from '../../db';                         // bypasses repository AND service
import { pageViews } from '../../db/schema';           // bypasses repository AND service
import { desc } from 'drizzle-orm';                    // infrastructure package in presentation
```

The import direction check from `dependency-rule.md` is explicit: `routes.ts` must NOT import from `drizzle-orm`, `../../db/schema`, or repository files directly.

**The correct fix:**

Add `getLiveViews(limit: number): Promise<PageView[]>` to `IAnalyticsRepository` (with an implementation in the repository using the same Drizzle query), add `getLiveActivity(limit: number): Promise<PageView[]>` to `AnalyticsService`, and have the route call `service.getLiveActivity(10)`. The route file's infrastructure imports are removed entirely.

---

## Summary Table

| # | Violation | Layer | Anti-Pattern | Severity |
|---|-----------|-------|-------------|----------|
| 1 | Two AnalyticsRepository instances | Application + Presentation | Service constructs own deps; routes create second instance | HIGH |
| 2 | getDashboardStats in repository | Infrastructure | Business aggregation logic in data-access layer | HIGH |
| 3 | No-arg constructor in AnalyticsService | Application | Missing constructor injection | HIGH |
| 4 | No IAnalyticsRepository port interface | Domain | Missing port; service depends on concrete class | HIGH |
| 5 | /analytics/live direct DB access | Presentation | Presentation imports drizzle-orm, db, schema directly | HIGH |

---

## Required Changes Before Merge

1. **Create `domain/ports.ts`** with `IAnalyticsRepository` interface (without `getDashboardStats`).
2. **Refactor `AnalyticsService`** to accept `IAnalyticsRepository` via constructor parameter, and move aggregation logic from repository into service methods.
3. **Rename/refactor `AnalyticsRepository`** to `DrizzleAnalyticsRepository implements IAnalyticsRepository`; replace `getDashboardStats` with `getViewsSince`.
4. **Register in Container**: add `get analyticsRepo(): IAnalyticsRepository` and `get analyticsService(): AnalyticsService` lazy getters.
5. **Refactor `analyticsRoutes`**: accept service as parameter (or receive from container), remove all `new AnalyticsRepository()` instantiation, remove all drizzle/db/schema imports.
6. **Add `getRecentViews` and a live-equivalent method** through the full stack (port → repo → service → route).

---

## What the Domain Layer Gets Right

`domain/types.ts` is clean: plain TypeScript interfaces, no external imports, no infrastructure leakage. `PageView`, `DashboardStats`, and `RetentionRow` are appropriate domain types. This foundation is correct and should be preserved as-is.
