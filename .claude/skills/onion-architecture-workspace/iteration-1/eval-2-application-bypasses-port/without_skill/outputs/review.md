# Architecture Review: Analytics Module (Pre-Merge)

## Summary

The analytics module has a solid foundation — the domain types are clean, the repository does real persistence work, and the service provides a reasonable use-case facade. However, there are several layering violations and design issues that should be addressed before this lands in main. The most serious is in `routes.ts`, which bypasses both service and repository and queries the database directly. There are also structural coupling problems throughout.

---

## Finding 1 — Routes Layer Bypasses Application Layer (CRITICAL)

**File:** `routes.ts`, lines 5–7, 39–46

```ts
import { db } from '../../db';
import { pageViews } from '../../db/schema';
import { desc } from 'drizzle-orm';
// ...
const rows = await db.select().from(pageViews).orderBy(desc(pageViews.timestamp)).limit(10);
```

The `/analytics/live` route imports the Drizzle `db` singleton and the `pageViews` schema table directly and executes a raw query. This violates the fundamental onion rule that outer layers may only call inward through defined ports. The routes layer (HTTP delivery) should never know about database internals.

Additionally, the `/analytics/recent` route calls `repo.getRecentViews()` directly rather than going through the service:

```ts
const repo = new AnalyticsRepository();
// ...
const events = await repo.getRecentViews(limit);
```

This means the route layer has a direct dependency on a concrete infrastructure class, bypassing any application logic the service layer might provide.

**Impact:** Business logic scattered across layers, impossible to unit-test routes without a real database, and any future caching/auditing/rate-limiting that belongs in the service will be silently skipped for these two endpoints.

**Fix:**
1. Add a `getLiveActivity(limit: number): Promise<PageView[]>` method to `AnalyticsService`.
2. Move the raw query to `AnalyticsRepository.getLiveViews(limit)`.
3. Remove `db`, `pageViews`, and `desc` imports from `routes.ts`.
4. Remove the `repo` instantiation from `routes.ts` — the route layer should only hold a reference to the service.

---

## Finding 2 — Service Hard-Codes Its Own Dependency (HIGH)

**File:** `service.ts`, lines 7–9

```ts
constructor() {
  this.repo = new AnalyticsRepository();
}
```

`AnalyticsService` instantiates `AnalyticsRepository` directly inside its constructor. This is constructor-side coupling: the service controls its own infrastructure dependency, making it impossible to swap implementations, mock the repository in unit tests, or apply dependency injection at the composition root.

**Impact:** Any test of `AnalyticsService` in isolation will hit the real database. The repository cannot be replaced with an in-memory or test double without modifying production source.

**Fix:** Accept the repository through constructor injection, typed against an interface (port):

```ts
// domain/ports.ts
export interface IAnalyticsRepository {
  record(view: PageView): Promise<void>;
  getDashboardStats(fromDate: Date): Promise<DashboardStats>;
  getRecentViews(limit: number): Promise<PageView[]>;
  getLiveViews(limit: number): Promise<PageView[]>;
}

// service.ts
export class AnalyticsService {
  constructor(private readonly repo: IAnalyticsRepository) {}
  // ...
}
```

Register and wire the concrete `AnalyticsRepository` at the module/composition-root level.

---

## Finding 3 — Routes Also Hard-Codes Two Concrete Dependencies (HIGH)

**File:** `routes.ts`, lines 17–18

```ts
const service = new AnalyticsService();
const repo = new AnalyticsRepository();
```

The route factory creates its own service and repository instances. This duplicates the composition concern and sidesteps any DI container or module registration. There is no guarantee these instances share state with instances created elsewhere, and tests cannot inject alternatives.

**Fix:** Accept `AnalyticsService` (and only the service — see Finding 1) as a parameter to `analyticsRoutes`, or resolve it from Fastify's decorator/plugin system:

```ts
export async function analyticsRoutes(app: FastifyInstance, opts: { service: AnalyticsService }) {
  const { service } = opts;
  // ...
}
```

---

## Finding 4 — Repository Contains Aggregation / Business Logic (MEDIUM)

**File:** `repository.ts`, lines 18–48

`getDashboardStats` fetches all rows since `fromDate` into memory and then computes bounce rate, unique sessions, unique users, top pages, and average duration in JavaScript. This is business-logic aggregation living inside the repository (infrastructure) layer.

**Impact:**
- On any non-trivial dataset, pulling every row since `fromDate` into the Node.js process will cause serious memory and latency problems.
- Logic for what counts as a "bounce" or how top pages are ranked is a domain concern, not a persistence concern.

**Fix:**
1. Move aggregation logic into `AnalyticsService` or a dedicated `AnalyticsDomainService`.
2. Push the heavy computations into SQL (COUNT, AVG, GROUP BY, window functions). The repository should return raw aggregated data from the DB, not raw rows for the app to crunch.
3. Alternatively, keep a thin in-process path for small datasets but cap it with an explicit limit and document the constraint.

---

## Finding 5 — No Port (Interface) Between Application and Infrastructure (MEDIUM)

There is no interface/port separating `AnalyticsService` from `AnalyticsRepository`. The service imports the concrete class directly:

```ts
import { AnalyticsRepository } from './repository';
```

In onion architecture, the application layer defines an inward-facing interface (port), and the infrastructure layer provides the outward-facing adapter that satisfies it. Without this boundary, the dependency arrow points the wrong way: application depends on infrastructure rather than infrastructure depending on application.

**Fix:** Define `IAnalyticsRepository` in `domain/ports.ts` (or `application/ports.ts`) and have `AnalyticsRepository` implement it. See the code example under Finding 2.

---

## Finding 6 — Loose Query Parameter Parsing in Routes (LOW)

**File:** `routes.ts`, lines 28, 33

```ts
const days = Number((req.query as any).days) || 30;
const limit = Math.min(Number((req.query as any).limit) || 50, 200);
```

The `as any` casts bypass TypeScript's type system and Fastify's querystring schema validation. `Number(undefined)` is `NaN`, and `NaN || 30` silently falls back — which is correct by accident. A non-numeric string like `"abc"` would also silently become the default, hiding bad inputs.

**Fix:** Define Fastify JSON Schema (or Zod) querystring schemas for each route and declare them in the route options so Fastify validates and coerces inputs automatically. Remove the `as any` casts.

---

## Finding 7 — `req.user` Cast to `any` (LOW)

**File:** `routes.ts`, line 22

```ts
const userId = (req.user as any)?.id ?? null;
```

Casting `req.user` to `any` loses type safety. If the user object shape ever changes, this silently passes `undefined` as `userId`.

**Fix:** Extend Fastify's `FastifyRequest` type declaration to include the `user` property with its real type. Use proper TypeScript module augmentation rather than `any`.

---

## Layer Dependency Summary

| Actual dependency | Correct direction | Violation? |
|---|---|---|
| `routes.ts` → `AnalyticsService` | Routes → Application | OK |
| `routes.ts` → `AnalyticsRepository` | Routes → Infrastructure (skip application) | YES |
| `routes.ts` → `db` / `pageViews` | Routes → DB internals (skip both layers) | YES (critical) |
| `AnalyticsService` → `AnalyticsRepository` (concrete) | Application → Infrastructure (no port) | YES |
| `AnalyticsRepository` → domain types | Infrastructure → Domain | OK |
| `AnalyticsService` → domain types | Application → Domain | OK |

---

## Recommended Remediation Order

1. **Immediate (block merge):** Remove `db` and `pageViews` imports from `routes.ts`. Add `getLiveViews` to the repository and a corresponding service method.
2. **Before merge:** Remove `AnalyticsRepository` import from `routes.ts`. Route layer should depend only on `AnalyticsService`.
3. **Before merge:** Inject `AnalyticsService` into `analyticsRoutes` rather than constructing it inline.
4. **Short-term:** Extract `IAnalyticsRepository` port. Inject into `AnalyticsService` via constructor.
5. **Short-term:** Push aggregation SQL into the DB; keep domain logic in the service, not the repository.
6. **Follow-up:** Add typed querystring schemas and remove `as any` casts.
