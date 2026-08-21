# Architecture Review: Billing Module

**File reviewed:** `modules/billing/routes.ts`
**Skill applied:** Onion Architecture
**Date:** 2026-08-19

---

## Summary

The billing module, as shipped, is a textbook example of the **Fat Controller** anti-pattern. Every route handler in `routes.ts` performs direct database access, calls the Stripe API directly, implements business logic, and manages state transitions — all without a service layer, a repository, or any domain abstraction. This is the most structurally damaging pattern to have in a growing codebase because it makes the billing logic untestable, tightly coupled to Stripe's SDK, and impossible to reuse.

The module currently has **zero correct layers**. It is a single-file flat structure where the presentation layer contains all of the infrastructure and application responsibilities.

---

## Violations Found

### 1. Fat Controllers (Critical — Anti-Pattern #3)

**All six route handlers** violate the presentation layer rule. Routes must only: validate input, resolve context, delegate to a service, and format the response. Instead, every handler in this file implements multi-step business workflows.

**`GET /billing/subscription`** — retrieves the local subscription record, then calls `stripe.subscriptions.retrieve()`, computes `daysLeft`, derives `isActive`, and extracts `planName`. This is application-layer orchestration and domain computation sitting in the route handler.

**`POST /billing/subscribe`** — fetches the user row, checks for an existing Stripe customer ID, conditionally creates a Stripe customer, creates a Stripe subscription, upserts the local `subscriptions` row, and extracts the client secret from the expanded invoice. This is a multi-step use case with conditional branching and side effects — 40+ lines of business flow in a route handler.

**`POST /billing/cancel`** — fetches the subscription, cancels it in Stripe, updates the local record, then fetches the user row purely to log their email. All of this belongs in a service.

**`GET /billing/invoices`** — fetches local subscription to get the Stripe customer ID, lists invoices from Stripe, maps the Stripe response to insert rows, performs a DB upsert, but then returns the raw Stripe API objects (not the local DB rows). This is a mixed cache-write / response-from-source pattern that creates data consistency confusion and belongs entirely in the application layer.

**`POST /billing/webhook`** — implements a Stripe webhook event dispatcher with three event-type branches, each performing direct DB writes. Webhook handling is application-layer domain logic — it processes external events and applies state transitions.

**`GET /billing/portal`** — the simplest handler but still makes a direct Stripe API call inside the route.

---

### 2. Direct Database Access in Routes (Critical — Dependency Rule Violation)

`routes.ts` imports directly from the database layer:

```typescript
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../db';
import { subscriptions, invoices, users } from '../../db/schema';
```

Per the dependency rule, `routes.ts` must never import from `drizzle-orm` or `../../db/schema`. These are infrastructure-layer concerns. The presentation layer is only permitted to depend on the application layer (services). Direct DB access in a route means:

- The route is doing repository work.
- The database schema is directly coupled to the HTTP response shape.
- There is no isolation point for testing routes without a real database.

---

### 3. Infrastructure Client Instantiated as a Module-Level Singleton (Critical)

```typescript
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });
```

The Stripe client is constructed at module load time using `process.env` directly, bypassing the project's `SecretsProvider`. This violates two rules:

1. **Secrets must flow through `SecretsProvider`**, not `process.env` (per `CLAUDE.md` project conventions).
2. **Infrastructure clients belong in the infrastructure layer**, constructed by the Container (composition root), not hardcoded in the presentation layer.

The `STRIPE_WEBHOOK_SECRET` is also read via `process.env` inside the webhook handler, which is the same violation.

---

### 4. No Service Layer (Critical — Missing Application Layer)

The billing module has no `service.ts`. There is no application layer at all. The use cases that should exist as named methods on a `BillingService` class are:

- `getSubscription(userId)` — retrieves and enriches subscription data
- `subscribe(userId, priceId)` — creates or upgrades a subscription
- `cancel(userId)` — cancels an active subscription
- `listInvoices(userId)` — fetches and caches invoice history
- `createPortalSession(userId)` — generates a Stripe billing portal URL
- `handleWebhookEvent(event)` — dispatches Stripe webhook events to state transitions

Without a service layer, none of these use cases can be tested in isolation, reused by other parts of the application (e.g., an admin panel, a job, a CLI), or swapped for a different payment provider.

---

### 5. No Repository Layer (Significant — Missing Infrastructure Abstraction)

The billing module performs raw Drizzle queries in six places. There is no `BillingRepository` that encapsulates these queries. The same query pattern — `db.select().from(subscriptions).where(eq(subscriptions.userId, userId))` — appears four times across different handlers with no reuse.

A `BillingRepository` should expose:

```typescript
interface BillingRepository {
  findSubscriptionByUserId(userId: string): Promise<Subscription | undefined>;
  upsertSubscription(data: InsertSubscription): Promise<void>;
  updateSubscriptionStatus(stripeId: string, status: string): Promise<void>;
  cancelSubscription(id: string): Promise<void>;
  upsertInvoices(invoices: InsertInvoice[]): Promise<void>;
}
```

---

### 6. No Domain Types — Raw DB Row Types Used as Domain Models (Significant — Anti-Pattern #4)

The code works entirely with raw `typeof subscriptions.$inferSelect` row shapes and raw `Stripe.*` types. There are no domain entities for `Subscription`, `Invoice`, or billing concepts. This means:

- If the `subscriptions` table schema changes, every route handler must be updated.
- If the payment provider changes from Stripe to another vendor, every route handler must change.
- Business concepts like "is this subscription active?" are computed inline in route handlers as ad-hoc expressions rather than being named domain behaviors.

---

### 7. No Input Validation via Zod Schemas (Moderate)

The `POST /billing/subscribe` handler uses an unsafe type cast instead of Zod validation:

```typescript
const { priceId } = req.body as { priceId: string };
```

Per DevDigest convention, request bodies must be validated via Zod schemas in the route's schema config using `fastify-type-provider-zod`. The `as` cast bypasses type safety and validation entirely.

---

### 8. Type Safety Bypassed with `as any` (Moderate)

Three uses of `as any` suppress TypeScript's type checker:

```typescript
const userId = (req.user as any).id;         // in every handler
const invoice = stripeSub.latest_invoice as any;  // in subscribe handler
```

The `req.user` cast indicates the auth decorator's type is not being surfaced correctly. This should be resolved by augmenting the Fastify request type via declaration merging. The `latest_invoice as any` cast to extract `payment_intent.client_secret` should use a properly typed Stripe expand pattern.

---

### 9. Webhook Handler Has No Security Boundary (Moderate)

The webhook endpoint calls `stripe.webhooks.constructEvent()` correctly for signature verification, but the handler is registered without any middleware exclusion for the auth check. If the standard Fastify auth hook applies to all routes, the webhook will fail because Stripe does not send user credentials. The raw body requirement for signature verification also needs explicit configuration.

---

### 10. Dunning Flow Is a Stub with No Implementation Path (Minor)

```typescript
app.log.warn(`Payment failed for user ${user.email} — trigger dunning flow`);
```

The `invoice.payment_failed` branch logs a warning but takes no action. This is acceptable for an MVP, but the comment "trigger dunning flow" embedded as a log string (rather than a `// TODO` comment or an event emission) suggests the placeholder will be forgotten. The correct approach is to emit a domain event or enqueue a job from the application layer.

---

## Refactoring Blueprint

The module should be restructured into proper onion layers:

```
modules/billing/
  domain/
    entities.ts          # Subscription, Invoice types (no Drizzle, no Stripe)
    ports.ts             # BillingRepository interface, StripeClient port interface
  service.ts             # BillingService — 6 use-case methods
  repository.ts          # DrizzleBillingRepository implements BillingRepository
  stripe-adapter.ts      # StripeClient adapter (wraps Stripe SDK)
  routes.ts              # Thin Fastify routes — validate, context, delegate, respond
```

### What a correctly layered route handler looks like:

```typescript
// AFTER refactoring — routes.ts
app.get('/billing/subscription', async (req, reply) => {
  const { userId } = await getContext(app.container, req);
  const result = await service.getSubscription(userId);
  if (!result) return reply.send({ active: false, plan: null, daysLeft: 0 });
  return reply.send(result);
});

app.post('/billing/subscribe', {
  schema: { body: SubscribeInput }  // Zod schema
}, async (req, reply) => {
  const { userId } = await getContext(app.container, req);
  const result = await service.subscribe(userId, req.body.priceId);
  return reply.status(201).send(result);
});
```

### What the service layer should encapsulate:

```typescript
// service.ts — Application layer
export class BillingService {
  constructor(
    private repo: BillingRepository,     // domain port
    private stripe: StripeClient,        // domain port (not Stripe SDK directly)
    private secrets: SecretsProvider,
  ) {}

  async subscribe(userId: string, priceId: string): Promise<SubscribeResult> {
    // All current route handler logic lives here
  }

  async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<void> {
    // Webhook dispatch logic lives here
  }
}
```

---

## Priority Order for Remediation

| Priority | Action |
|----------|--------|
| 1 (Critical) | Create `BillingService` — extract all use-case logic out of route handlers |
| 2 (Critical) | Create `BillingRepository` — extract all Drizzle queries into one class |
| 3 (Critical) | Create `StripeClient` port — inject via Container, read secret via `SecretsProvider` |
| 4 (High) | Define domain types `Subscription` and `Invoice` — decouple from DB row types |
| 5 (High) | Add Zod request schemas — replace `as { priceId: string }` cast |
| 6 (Moderate) | Fix `req.user` typing — Fastify type augmentation for the auth decorator |
| 7 (Moderate) | Clarify webhook auth exclusion and raw body parsing |
| 8 (Low) | Replace dunning log stub with a job enqueue or domain event |

---

## Conclusion

The billing module has no onion layering at all — it is a single-file script masquerading as a route plugin. Every structural anti-pattern in the onion architecture rule set is present. Before the codebase grows, the module needs a service layer and a repository layer at minimum. The Stripe client must be moved to an adapter injected through the Container. Until these changes are made, the billing module cannot be unit tested, cannot be refactored safely, and will accumulate business logic debt rapidly as requirements evolve.
