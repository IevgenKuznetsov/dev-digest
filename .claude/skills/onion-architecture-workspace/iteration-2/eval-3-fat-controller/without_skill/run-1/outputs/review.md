# Architecture Review: Billing Module (`modules/billing/routes.ts`)

**Reviewer:** Architecture Review Agent  
**Date:** 2026-08-19  
**File:** `modules/billing/routes.ts`  
**Verdict:** Multiple critical structural issues must be resolved before codebase growth.

---

## Executive Summary

The billing module is a textbook **Fat Controller** anti-pattern. All business logic, data access, external API calls, and side-effects are crammed into six route handlers with zero separation of concerns. This creates immediate risks across consistency, testability, operational reliability, and security. The issues are not cosmetic — they represent structural debt that compounds with every new feature.

---

## Issue Catalog

Issues are prioritized: **CRITICAL** (blocks merge or creates data loss risk) → **HIGH** (degrades reliability or security) → **MEDIUM** (harms maintainability) → **LOW** (code quality / hygiene).

---

### [CRITICAL-1] Stripe Secret Initialized at Module Load — Crashes on Missing Key

```ts
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });
```

**Problem:** The `!` non-null assertion suppresses TypeScript's guard. If `STRIPE_SECRET_KEY` is absent or empty at process start, the Stripe SDK initializes with `undefined` cast to string. The crash surfaces as a cryptic runtime error at the first API call rather than at boot. Worse: this module-level singleton is untestable — tests cannot inject a mock client.

**Fix:** Validate the key in a startup hook (`fastify.addHook('onReady', ...)`) and throw a descriptive error. Inject the client via Fastify `decorate` or dependency injection so tests can substitute a mock.

---

### [CRITICAL-2] Non-Atomic Subscribe: Stripe Charge Created but DB Write Can Fail

```ts
const stripeSub = await stripe.subscriptions.create({ ... });

await db.insert(subscriptions).values({ ... }).onConflictDoUpdate({ ... });
```

**Problem:** If the `db.insert` fails (network blip, constraint violation, Postgres outage), the subscription exists in Stripe but not in the local DB. The user is charged but the system has no record. There is no compensating transaction, no retry, no dead-letter. Refunds require manual intervention.

**Fix:** This is a two-phase-commit problem with an external system. The minimum viable mitigation:
1. Persist a `pending` subscription row *before* calling Stripe, storing the `customerId`.
2. After Stripe confirms, update the row to the active state.
3. A background reconciliation job can recover orphaned Stripe subscriptions.

---

### [CRITICAL-3] Cancel: Stripe Cancels but DB Update Can Fail — Divergence

```ts
await stripe.subscriptions.cancel(sub.stripeId);

await db.update(subscriptions)
  .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
  .where(eq(subscriptions.id, sub.id));
```

**Problem:** Identical to CRITICAL-2 but in reverse. Stripe reports the subscription cancelled; if the DB update throws, the local record still shows `active`. The user cannot re-subscribe (Stripe rejects), UI shows active, and support has no automated path to detect it.

**Fix:** Same reconciliation strategy as above. Additionally, the webhook handler for `customer.subscription.deleted` provides a natural idempotent repair path — but only if the webhook is always delivered, which is not guaranteed under network partitions.

---

### [CRITICAL-4] Webhook Handler Has No Body-Raw Guarantee

```ts
event = stripe.webhooks.constructEvent(
  req.rawBody as Buffer,
  sig,
  process.env.STRIPE_WEBHOOK_SECRET!,
);
```

**Problem:** `req.rawBody` is not a standard Fastify property. Stripe signature verification requires the *exact* raw bytes received over the wire. If Fastify's body parser has already parsed and re-serialized the body (the default), the HMAC will never match and all webhooks will be rejected with 400. This silently drops payment failure events, subscription lifecycle events, and dunning triggers.

**Fix:** Register the `/billing/webhook` route with `config: { rawBody: true }` and use the `fastify-raw-body` plugin (or equivalent) to capture the raw buffer before JSON parsing runs.

---

### [HIGH-1] No Input Validation on `priceId`

```ts
const { priceId } = req.body as { priceId: string };
```

**Problem:** This is a type cast, not validation. `priceId` could be missing, null, an object, or an attacker-supplied Stripe price ID from another merchant account. The raw value is passed directly to `stripe.subscriptions.create`. There is no Zod schema, no JSON Schema, no `required` check. A missing `priceId` will produce an opaque Stripe error that leaks API error details to the caller.

**Fix:** Define a Zod schema (or Fastify JSON Schema) for every request body. Validate before any business logic. The project already uses Zod; use `z.string().startsWith('price_')` as a structural guard.

---

### [HIGH-2] `req.user` Cast to `any` — Auth Contract Is Invisible

```ts
const userId = (req.user as any).id;
```

**Problem:** This appears in all six handlers. It bypasses TypeScript's type system entirely. If the auth plugin changes the shape of `req.user`, TypeScript will not catch it. Runtime errors will surface in production.

**Fix:** Extend Fastify's `FastifyRequest` interface via module augmentation to type `req.user` correctly. Authentication guard should be a Fastify preHandler hook on a route prefix, not an implicit contract across every handler.

---

### [HIGH-3] `GET /billing/invoices` Mutates State — HTTP Contract Violation

```ts
app.get('/billing/invoices', async (req, reply) => {
  ...
  await db.insert(invoices).values(toUpsert).onConflictDoNothing();
  return reply.send({ invoices: stripeInvoices.data });
});
```

**Problem:** This GET handler writes to the database. This violates HTTP semantics (GET must be safe and idempotent). Consequences:
- CDN/proxy caches may serve stale responses without triggering the upsert.
- Browser prefetch/eager load triggers unexpected writes.
- Load balancer health checks, logging middleware, or crawlers that hit GET routes cause unintended inserts.
- The response returns *Stripe raw data* (`stripeInvoices.data`), not the DB-mapped shape — the upserted rows are never returned, making the DB write effectively dead code.

**Fix:** Move the sync logic to an explicit `POST /billing/invoices/sync` or a background job triggered by webhooks (`invoice.payment_succeeded`). The GET should read only from the DB.

---

### [HIGH-4] Dunning Flow Is a Log Statement — Silent Failure

```ts
if (user) {
  app.log.warn(`Payment failed for user ${user.email} — trigger dunning flow`);
}
```

**Problem:** Payment failure handling does nothing except log. If a payment fails, the user is not notified, no retry is scheduled, and no dunning email is sent. The comment "trigger dunning flow" suggests this was meant to be implemented. In production this means silent revenue loss.

**Fix:** Implement actual dunning: enqueue a job (BullMQ, pg-boss, etc.) to send a payment-failure notification. Log the intent, but also act on it.

---

### [HIGH-5] User Fetched After Cancel for Logging — Unnecessary DB Round-Trip and Unsafe

```ts
await stripe.subscriptions.cancel(sub.stripeId);
await db.update(subscriptions).set({ ... }).where(...);

const [user] = await db.select().from(users).where(eq(users.id, userId));
app.log.info(`Subscription cancelled for ${user.email}`);
```

**Problem:** The user is fetched *after* the cancel solely for logging. If the user row is missing (race condition, soft-delete, test teardown), `user.email` throws `TypeError: Cannot read properties of undefined`. This would swallow the error in a way that might appear to the caller as a 500 on an otherwise successful cancel. More fundamentally, `userId` is available at the start of the handler — the user could have been fetched once, earlier.

**Fix:** Fetch the user once at the top of the handler (or retrieve email from `req.user`). Guard with a null check before accessing properties.

---

### [MEDIUM-1] All Business Logic Is Untestable Without a Live Database and Stripe

Every handler directly imports `db` and instantiates `stripe` at module scope. There are no service interfaces, no repository abstractions, no dependency injection seams. To test subscription creation, a test must either:
- Spin up Postgres and Stripe test mode (slow, flaky, requires secrets), or
- Monkey-patch module-level variables (fragile, non-standard in ESM).

**Fix:** Extract a `BillingService` class (or set of functions) that accepts `db` and `stripe` as constructor/parameter dependencies. Route handlers become thin adapters that parse input, call the service, and map the output to HTTP responses. Services can be unit-tested with mocked dependencies.

---

### [MEDIUM-2] Layering Violation — Routes Import DB Schema and ORM Directly

```ts
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../db';
import { subscriptions, invoices, users } from '../../db/schema';
```

**Problem:** Route handlers are infrastructure adapters. They should not know about database schemas, ORM query builders, or table structures. This couples the HTTP layer directly to the persistence layer. Any schema rename ripples through routes. The `and` and `desc` imports are not even used, indicating copy-paste without cleanup.

**Fix:** Introduce a repository or data-access layer. Routes call `billingRepository.findSubscriptionByUserId(userId)`. The repository owns `db` and schema imports.

---

### [MEDIUM-3] `onConflictDoNothing` for Invoices Silently Drops Updates

```ts
await db.insert(invoices).values(toUpsert).onConflictDoNothing();
```

**Problem:** If an invoice's status changes (e.g., `open` → `paid`), `onConflictDoNothing` silently ignores the update. Invoice records will become stale with no correction path.

**Fix:** Use `onConflictDoUpdate` with the fields that should be updated (`status`, `amountCents`, `pdfUrl`).

---

### [MEDIUM-4] Webhook Handler Returns 200 for Unhandled Event Types

```ts
if (event.type === 'customer.subscription.updated') { ... }
if (event.type === 'customer.subscription.deleted') { ... }
if (event.type === 'invoice.payment_failed') { ... }

return reply.send({ received: true });
```

**Problem:** Unhandled event types (e.g., `invoice.payment_succeeded`, `payment_intent.succeeded`) silently succeed with `{ received: true }`. This is correct for Stripe (return 200 to prevent retries), but internally the system has no observability into which events are processed vs. ignored. If a new event type needs handling, there is no indication that the existing catch-all masks it.

**Fix:** Log unhandled event types at `debug` level with the event type name. Use a structured switch/dispatch table instead of sequential `if` blocks for clarity and exhaustiveness.

---

### [MEDIUM-5] `APP_URL` Used Without Validation in Portal Handler

```ts
return_url: `${process.env.APP_URL}/settings/billing`,
```

**Problem:** If `APP_URL` is undefined, the return URL becomes `undefined/settings/billing`, which Stripe may reject or silently accept as a malformed URL. No validation, no fallback.

**Fix:** Validate `APP_URL` at startup (add to a config validation step alongside `STRIPE_SECRET_KEY`).

---

### [LOW-1] Unused Imports

```ts
import { eq, and, desc } from 'drizzle-orm';
```

`and` and `desc` are imported but never used. This is minor but indicates copy-paste patterns and lack of linting enforcement.

---

### [LOW-2] Stripe API Version Is Hardcoded in Application Code

```ts
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });
```

The API version should live in configuration (a constants file or environment config), not inline in a route file. Upgrading the API version requires finding every hardcoded occurrence.

---

### [LOW-3] `req.body as any` via Cast in Invoice Handler

The `invoice.payment_failed` webhook extracts `inv.customer as string` with a type cast. The `Stripe.Invoice` type has `customer` typed as `string | Stripe.Customer | Stripe.DeletedCustomer | null`. The cast skips the `null` / object check. If the customer was expanded, this is a string coercion of an object.

---

## Structural Recommendations (Priority Order)

### P0 — Fix Before Any Production Traffic

1. **Fix the raw-body webhook problem (CRITICAL-4).** All webhook events are currently being rejected or silently mishandled.
2. **Add compensating logic for subscribe/cancel (CRITICAL-2, CRITICAL-3).** Implement a `pending` → `active` state transition pattern with reconciliation.

### P1 — Fix This Sprint

3. **Validate all inputs with Zod (HIGH-1).** Every request body and query param must be schema-validated before business logic runs.
4. **Implement actual dunning (HIGH-4).** Replace the log statement with a queued job.
5. **Fix `GET /billing/invoices` to be read-only (HIGH-3).** Move sync logic out of the GET handler.

### P2 — Refactor Before Feature Growth

6. **Extract `BillingService` (MEDIUM-1).** Move all business logic out of route handlers. Route handlers should be 5–10 lines each.
7. **Extract `BillingRepository` (MEDIUM-2).** Isolate all DB access behind a data-access interface.
8. **Type `req.user` properly (HIGH-2).** Augment `FastifyRequest` and remove all `as any` casts.
9. **Fix `onConflictDoNothing` → `onConflictDoUpdate` for invoices (MEDIUM-3).**

### P3 — Code Quality

10. Remove unused imports (`and`, `desc`).
11. Extract Stripe API version and `APP_URL` to validated config.
12. Add structured webhook dispatch (switch table).

---

## Target Architecture

The module should follow an onion/layered structure:

```
routes.ts          (HTTP adapter: parse → call service → map response)
    ↓
BillingService     (orchestration: business rules, no HTTP or DB knowledge)
    ↓
BillingRepository  (data access: DB queries only, no business logic)
    ↓
StripeClient       (external API adapter: injectable, mockable)
```

Each layer depends only on the layer below it. Routes have no ORM imports. Services have no Fastify imports. Repositories have no Stripe imports.

---

## Issue Summary Table

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| CRITICAL-1 | Critical | Config | Stripe client crashes silently on missing key |
| CRITICAL-2 | Critical | Consistency | Subscribe: non-atomic Stripe + DB write |
| CRITICAL-3 | Critical | Consistency | Cancel: non-atomic Stripe + DB update |
| CRITICAL-4 | Critical | Correctness | Webhook raw-body not guaranteed |
| HIGH-1 | High | Security | No input validation on priceId |
| HIGH-2 | High | Type Safety | req.user cast to any in all handlers |
| HIGH-3 | High | HTTP Contract | GET handler mutates database |
| HIGH-4 | High | Business Logic | Dunning is a log statement |
| HIGH-5 | High | Reliability | User fetch post-cancel can throw |
| MEDIUM-1 | Medium | Testability | No service layer — untestable without infra |
| MEDIUM-2 | Medium | Layering | Routes import ORM and DB schema directly |
| MEDIUM-3 | Medium | Correctness | onConflictDoNothing silently drops invoice updates |
| MEDIUM-4 | Medium | Observability | Unhandled webhook events are invisible |
| MEDIUM-5 | Medium | Config | APP_URL unvalidated in portal handler |
| LOW-1 | Low | Hygiene | Unused imports (and, desc) |
| LOW-2 | Low | Config | Stripe API version hardcoded inline |
| LOW-3 | Low | Type Safety | inv.customer cast without null/object check |
