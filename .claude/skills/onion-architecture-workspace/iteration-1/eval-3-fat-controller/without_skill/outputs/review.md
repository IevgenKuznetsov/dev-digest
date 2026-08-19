# Architecture Review: Billing Module

**File reviewed:** `modules/billing/routes.ts`
**Reviewer:** Claude (architecture review agent)
**Date:** 2026-08-19

---

## Summary

The billing module is implemented as a single "fat controller" — all business logic, data access, and external API orchestration lives directly inside Fastify route handlers. While this pattern can work for very small proof-of-concept code, it creates significant structural debt that compounds quickly as the module grows. The issues identified below range from layer-boundary violations to missing error handling and testability gaps.

---

## Structural Issues

### 1. No Service or Domain Layer (Critical)

Every route handler directly imports and calls `stripe.*` and `db.*`. There is no intermediate layer that encapsulates business logic. This violates the single-responsibility principle at the module level and makes the entire billing feature impossible to unit-test without hitting real databases and external APIs.

**What is missing:**
- A `BillingService` (or equivalent application-layer class) that owns orchestration logic such as "create or retrieve Stripe customer, create subscription, persist record."
- A repository or data-access layer that wraps the Drizzle queries so they can be swapped or mocked in tests.
- A domain model or value objects for concepts like `Subscription` and `Invoice` rather than raw DB rows and Stripe SDK objects scattered through handler code.

**Impact:** Any change to subscription creation logic (e.g., adding trial periods, applying coupons) requires touching route-handler code, which should be concerned only with HTTP concerns (parsing, validation, response shaping).

---

### 2. Stripe Client Instantiated as a Module-Level Singleton (High)

```ts
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });
```

The Stripe client is instantiated at module load time using `process.env` directly. This:

- Bypasses the project's `SecretsProvider` convention (secrets should not come from `process.env` directly per project conventions).
- Makes it impossible to inject a mock Stripe client in tests — there is no seam.
- Hard-codes the API version as a string literal inside route registration code.

**Recommendation:** Instantiate the Stripe client inside a `StripeAdapter` class that accepts the key via constructor injection (from `SecretsProvider`). Register it as a Fastify plugin/decorator so it can be overridden in tests.

---

### 3. Input Validation Is Absent (High)

```ts
const { priceId } = req.body as { priceId: string };
```

The `POST /billing/subscribe` handler casts `req.body` to a type with no runtime validation. If `priceId` is missing, malformed, or injected, this passes a potentially undefined or malicious string directly to `stripe.subscriptions.create`. The same pattern applies to the webhook handler's header parsing.

**Recommendation:** Define Zod schemas (or JSON Schema objects) for every request body and register them via Fastify's `schema` property on the route. Fastify will reject invalid payloads before the handler runs.

---

### 4. `req.user` Typed as `any` Across All Handlers (High)

```ts
const userId = (req.user as any).id;
```

This pattern appears in every authenticated route. Casting to `any` defeats TypeScript's safety guarantees. If the auth plugin changes the shape of `req.user`, this code silently breaks at runtime.

**Recommendation:** Extend Fastify's `FastifyRequest` interface via declaration merging to include a properly typed `user` property. This is a one-line change in a shared types file and eliminates all these casts.

---

### 5. Cross-Concern Data Fetching — User Loaded Inside Cancel Handler (Medium)

```ts
await stripe.subscriptions.cancel(sub.stripeId);
await db.update(subscriptions).set({ status: 'cancelled', ... }).where(...);
const [user] = await db.select().from(users).where(eq(users.id, userId));
app.log.info(`Subscription cancelled for ${user.email}`);
```

The cancel handler loads the user record *after* the cancellation solely for logging purposes. This is an unnecessary DB query in the hot path (the user's email has nothing to do with the cancel operation itself). It also introduces a subtle ordering issue: if the `db.update` or the final `db.select` fails, the Stripe cancellation has already been executed with no compensation.

**Recommendation:** Move logging concerns out of route handlers. If the email is needed for an audit trail, pass it via a structured log context object populated at authentication time (available on `req.user`). Address the partial-failure risk with a try/catch or by moving Stripe calls inside a transaction wrapper.

---

### 6. GET /billing/invoices Performs a Write as a Side Effect (Medium)

```ts
app.get('/billing/invoices', async (req, reply) => {
  // ...fetches from Stripe...
  await db.insert(invoices).values(toUpsert).onConflictDoNothing();
  return reply.send({ invoices: stripeInvoices.data });
});
```

A GET endpoint that silently upserts records into the database violates HTTP semantics (GET must be idempotent and safe). It also means the response payload (raw Stripe objects) diverges from what was persisted (a mapped subset). Callers cannot rely on the DB as a consistent source of truth.

**Recommendation:** Separate the sync concern from the read concern. Either use a background job (or a dedicated `POST /billing/invoices/sync` endpoint) to populate the local `invoices` table, or query the local table and return those records (with a separate sync path).

---

### 7. Webhook Handler Uses a Bare `if` Chain Instead of a Typed Dispatch Table (Low-Medium)

The webhook handler uses three sequential `if` statements. As more Stripe event types are handled (payment succeeded, trial ending, etc.), this block will grow into a maintenance burden with no clear boundaries between event concerns.

**Recommendation:** Extract each event type into its own named handler function (or move them to a dedicated `WebhookService`). Use an event-type dispatch map for readability and extensibility.

---

### 8. No Error Handling for Stripe API Failures (High)

None of the route handlers wrap Stripe SDK calls in try/catch blocks. A `stripe.subscriptions.retrieve` timeout or a rate-limit error from Stripe will result in an unhandled rejection propagating up to Fastify's global error handler, which will return a generic 500. Callers receive no actionable information, and the error will not be categorized as a third-party dependency failure.

**Recommendation:** Wrap all external API calls in try/catch. Distinguish between Stripe errors (e.g., `StripeCardError`, `StripeRateLimitError`) and internal errors. Return appropriate HTTP status codes and structured error responses. Consider a dedicated error-mapping layer in the Stripe adapter.

---

### 9. `process.env.APP_URL` Read Inline in a Route Handler (Low)

```ts
return_url: `${process.env.APP_URL}/settings/billing`,
```

Configuration values are accessed ad-hoc from `process.env` inside handler bodies. This makes configuration surface area invisible and untestable.

**Recommendation:** Centralize all configuration (non-secret values) in a typed config object loaded once at startup. Inject it via Fastify decorators or a service locator.

---

## Missing Layers Summary

| Layer | Expected | Present |
|---|---|---|
| Domain model (Subscription, Invoice value objects) | Yes | No |
| Application service (BillingService) | Yes | No |
| Repository / data-access abstraction | Yes | No |
| External adapter (StripeAdapter) | Yes | No |
| Request validation (Zod / JSON Schema) | Yes | No (partial cast only) |
| Route handler (HTTP orchestration) | Yes | Yes (but overloaded) |

---

## Recommended Refactoring Path

1. **Extract a `StripeAdapter`** — wraps the Stripe SDK, accepts injected credentials, maps Stripe errors to domain errors.
2. **Extract a `BillingRepository`** — owns all Drizzle queries for `subscriptions` and `invoices`. Returns typed domain objects, not raw DB rows.
3. **Create a `BillingService`** — orchestrates adapter + repository calls. Contains all business logic (create-or-get-customer, cancel-with-status-update, etc.).
4. **Add Zod schemas for all request bodies** — registered on each route for automatic validation.
5. **Fix `req.user` typing** — one augmentation in a shared types file.
6. **Separate the invoice sync concern** — move the upsert out of the GET handler.
7. **Add Stripe error handling** — try/catch with typed error mapping in the adapter.

The route file should shrink to pure HTTP concerns: parse validated input, call the service, shape the response. All other logic belongs in the layers above.
