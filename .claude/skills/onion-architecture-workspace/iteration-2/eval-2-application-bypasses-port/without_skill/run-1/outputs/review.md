# Analytics Module — Pre-Merge Architecture Review

## Executive Summary

The analytics module has a structural violation that undermines the entire purpose of having a layered architecture: the application layer (routes) bypasses the service and repository ports and reaches directly into the database. This is the most serious issue and must be fixed before merge. There are also testability, type-safety, and scalability concerns that should be addressed.

---

## Issue 1 (CRITICAL) — Route Handler Bypasses All Layers and Queries the DB Directly

**File:** `routes.ts`, lines 39–46

```ts
app.get('/analytics/live', async (req, reply) => {
  const rows = await db
    .select()
    .from(pageViews)
    .orderBy(desc(pageViews.timestamp))
    .limit(10);
  return reply.send({ live: rows });
});
```

The `/analytics/live` route imports `db`, `pageViews`, and `desc` from Drizzle and executes a raw query inline inside the route handler. This:

- Completely bypasses the service layer and the repository layer.
- Leaks raw DB schema types (`pageViews` table columns) directly into the HTTP response — if the schema changes, the response shape silently changes too.
- Makes the route untestable without a real database.
- Duplicates logic that already exists in `AnalyticsRepository.getRecentViews()`.

**Fix:** Delete the inline query. Add a `getLiveViews(limit: number)` method to `AnalyticsRepository` (or reuse `getRecentViews(10)`), expose it through `AnalyticsService`, and call the service method in the route. Remove the `db`, `pageViews`, and `desc` imports from `routes.ts` entirely.

---

## Issue 2 (CRITICAL) — Route Handler Bypasses the Service and Calls the Repository Directly

**File:** `routes.ts`, lines 17–18 and 33–36

```ts
const repo = new AnalyticsRepository();   // line 18 — constructed alongside service

app.get('/analytics/recent', async (req, reply) => {
  const events = await repo.getRecentViews(limit);  // bypasses service
  return reply.send({ events });
});
```

The `/analytics/recent` route instantiates its own `AnalyticsRepository` and calls `repo.getRecentViews()` directly, skipping `AnalyticsService.getRecentActivity()` entirely. `AnalyticsService` already wraps this exact call (lines 35–37 of `service.ts`). This creates two competing paths to the same data, meaning:

- Any future business logic added to `getRecentActivity()` (rate-limiting, redaction of PII, permission checks) will silently not apply to the `/analytics/recent` endpoint.
- Two separate `AnalyticsRepository` instances are created per request lifecycle, doubling connection overhead.

**Fix:** Remove the `repo` instantiation from `routes.ts`. Call `service.getRecentActivity(limit)` instead, which already exists and returns the same data.

---

## Issue 3 (HIGH) — Concrete Class Instantiation Inside Constructors Kills Testability

**File:** `service.ts`, lines 7–8

```ts
constructor() {
  this.repo = new AnalyticsRepository();
}
```

**File:** `routes.ts`, lines 17–18

```ts
const service = new AnalyticsService();
const repo = new AnalyticsRepository();
```

Both `AnalyticsService` and the route function hardcode `new AnalyticsRepository()` and `new AnalyticsService()`. There is no dependency injection seam. This means:

- Unit tests for `AnalyticsService` cannot mock the repository — they always hit the real DB.
- Integration tests for routes cannot swap in a fake service.
- The module is tightly coupled to the concrete Drizzle implementation.

**Fix:** Define an `IAnalyticsRepository` interface (port) in `domain/types.ts` or a dedicated `domain/ports.ts`. Accept it as a constructor parameter in `AnalyticsService`. Accept `AnalyticsService` (or an interface) as a parameter in `analyticsRoutes`. Register and wire instances at module registration time (e.g., `modules/index.ts`).

---

## Issue 4 (HIGH) — Business Logic Executed Inside the Repository Layer

**File:** `repository.ts`, lines 24–47

`getDashboardStats()` fetches all rows from the `pageViews` table for the given date range and then performs all aggregation in JavaScript:

- Bounce rate calculation (lines 31–34)
- `avgDurationMs` (lines 27–29)
- `topPages` ranking and slicing (lines 36–45)
- `uniqueSessions` / `uniqueUsers` using in-memory `Set`s (lines 25–26)

This is domain/application logic sitting inside the persistence layer. Repositories should map rows to domain objects — business rules belong in the service or domain layer. Beyond the layering violation:

- Fetching all rows into memory will not scale. A table with millions of page views will cause OOM or timeout.
- The calculations should be pushed to SQL (`COUNT`, `COUNT DISTINCT`, `AVG`, `GROUP BY`, window functions for bounce rate), which is what the database is optimized for.

**Fix:** Move the aggregation calculations to SQL queries inside the repository (return pre-aggregated data), or extract the calculation logic into a domain service / pure function in the domain layer, with the repository returning only raw `PageView` rows.

---

## Issue 5 (MEDIUM) — `userId` in Query Parameters Is Injected via `any` Cast Without Validation

**File:** `routes.ts`, lines 22, 28, 33

```ts
const userId = (req.user as any)?.id ?? null;
const days = Number((req.query as any).days) || 30;
const limit = Math.min(Number((req.query as any).limit) || 50, 200);
```

Three separate `(req.query as any)` casts bypass Fastify's type-safe query schema system. Fastify 5 supports Zod-validated query schemas via `fastify-type-provider-zod`. Casting to `any` means:

- A non-numeric `days` value (e.g., `?days=abc`) produces `NaN`, and `Number('abc') || 30` silently falls back to 30 — no error is reported to the caller.
- The `limit` cap (200) is the only guard; there is no minimum or type enforcement beyond the `Number()` coercion.
- `req.user as any` suppresses any type errors that would catch an auth middleware misconfiguration.

**Fix:** Declare typed query schemas using Zod and the `fastify-type-provider-zod` type provider. Use `req.user` typed via an augmented `FastifyRequest` interface, not a cast to `any`.

---

## Issue 6 (MEDIUM) — `trackSchema` Does Not Validate `path` or `sessionId` Format

**File:** `routes.ts`, lines 9–14

```ts
const trackSchema = z.object({
  path: z.string(),
  sessionId: z.string(),
  durationMs: z.number().int().nonnegative(),
  referrer: z.string().nullable().optional(),
});
```

`path` accepts any string including empty string or a 10 MB payload. `sessionId` is completely unconstrained. `durationMs` is correctly validated as a non-negative integer, but there is no upper bound — a client could submit `durationMs: 9999999999` without rejection.

**Fix:**
- `path`: `z.string().min(1).max(2048).startsWith('/')`
- `sessionId`: `z.string().uuid()` or at minimum `.min(1).max(128)`
- `durationMs`: add `.max(86_400_000)` (24 hours) as a sanity ceiling
- `referrer`: `z.string().url().nullable().optional()` to reject malformed referrers

---

## Issue 7 (LOW) — `topPages` Ranking Is Done In-Memory With No SQL Index Support

**File:** `repository.ts`, lines 36–45

The top-10 pages are computed by fetching all rows and sorting them in JavaScript. Even if the aggregation logic is moved to SQL (as recommended in Issue 4), the `path` column should have an index to support `GROUP BY path` efficiently.

**Fix:** Add a DB index on `(timestamp, path)` — composite to support both the `WHERE timestamp >= ?` filter and the `GROUP BY path` aggregation in a single index scan.

---

## Issue 8 (LOW) — Response Envelope Inconsistency

**File:** `routes.ts`

Three routes use different response shapes for comparable data:

| Route | Response shape |
|---|---|
| `POST /analytics/track` | `{ ok: true }` |
| `GET /analytics/dashboard` | `stats` (flat object) |
| `GET /analytics/recent` | `{ events: [...] }` |
| `GET /analytics/live` | `{ live: [...] }` |

`/recent` wraps in `events`, `/live` wraps in `live`, `/dashboard` returns a bare object. This inconsistency makes the client harder to maintain and signals a lack of a shared response contract.

**Fix:** Define a shared response envelope in `@devdigest/shared` contracts and use it consistently across all routes. At minimum align the array-returning routes to use the same property name (e.g., `{ data: [...] }`).

---

## Prioritized Recommendations

| Priority | Issue | Action |
|---|---|---|
| CRITICAL | Route queries DB directly (`/live`) | Remove inline query; route through service |
| CRITICAL | Route calls repository directly (`/recent`) | Remove `repo` from routes; use `service.getRecentActivity()` |
| HIGH | No dependency injection | Introduce port interface; inject via constructor |
| HIGH | Business logic in repository | Move aggregation to SQL or domain layer |
| MEDIUM | `any` casts on query params and user | Use typed query schemas and augmented request types |
| MEDIUM | Weak input validation on `trackSchema` | Add length/format/range constraints |
| LOW | Missing DB index for common query pattern | Add `(timestamp, path)` composite index |
| LOW | Inconsistent response envelopes | Align all routes to a shared contract shape |

---

## File-by-File Summary

- **`domain/types.ts`** — Clean. Pure TypeScript interfaces with no imports. No issues.
- **`repository.ts`** — Contains business logic that belongs in the service/domain layer. Will not scale for large datasets. Imports `db` directly (acceptable for a repository), but aggregation logic must move out.
- **`service.ts`** — Correct responsibility scope, but hardcodes `new AnalyticsRepository()` making it untestable. Thin wrapper today, but correct place for business rules.
- **`routes.ts`** — Two separate architectural violations (direct DB access, direct repo access). Also has type-safety and validation issues. Needs the most work before merge.
