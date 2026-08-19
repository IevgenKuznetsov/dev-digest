# Architecture Review: Billing Module

**Reviewer:** onion-architecture skill (v1.0.0)
**File reviewed:** `modules/billing/routes.ts`
**Date:** 2026-08-19

---

## Executive Summary

The billing module is a textbook **Fat Controller** anti-pattern. Every layer — domain, application, infrastructure, and presentation — has been collapsed into a single `routes.ts` file. All six handlers perform direct DB queries via Drizzle, call Stripe directly, contain branching business logic, and manage their own error handling. Before this module is touched again, the structural debt should be addressed; it will compound fast as billing logic grows.

Severity ratings: **CRITICAL** (blocks future extensibility), **HIGH** (active correctness risk), **MEDIUM** (design violation), **LOW** (minor smell).

---

## Issue 1 — /billing/cancel: No Compensation for Partial Failure [CRITICAL]

```typescript
// routes.ts lines 89-93
await stripe.subscriptions.cancel(sub.stripeId);   // (1) Stripe mutated

await db                                            // (2) DB update — may fail
  .update(subscriptions)
  .set({ status: 'cancelled', ... })
  .where(eq(subscriptions.id, sub.id));
```

**What goes wrong:** Stripe's API is called first and succeeds. The subscription is now cancelled in Stripe's system. If the subsequent DB `update` throws (network blip, constraint violation, DB overload), the handler propagates an unhandled exception. The client receives a 500. On retry the client calls `/billing/cancel` again; the DB still shows the old status; Stripe returns an error because the subscription is already cancelled. The local DB record is now permanently out of sync with Stripe's truth.

**There is no compensation mechanism.** The code does not:
- Attempt to reactivate the Stripe subscription on DB failure
- Catch the DB error and reconcile via webhook
- Wrap both operations in a saga/outbox pattern
- Even log the partial-failure state distinctly

**Fix:** The canonical solution for two-phase mutations involving an external API is to use Stripe as the system of record and let webhooks drive the DB. The route should call `stripe.subscriptions.cancel()`, return 200 immediately, and trust the `customer.subscription.deleted` webhook (which already exists at line 159) to update the DB. This makes the operation idempotent: if the DB write from the webhook fails it will be retried by Stripe's delivery mechanism.

If synchronous DB confirmation is required for UX, the order should be reversed: update the DB to `cancellation_pending`, call Stripe, then update to `cancelled` — with the webhook as the safety net for the final state.

---

## Issue 2 — Stripe Client at Module Scope: Injection Seam Problem [HIGH]

```typescript
// routes.ts line 7 — module-level singleton
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });
```

**The injection seam problem:** The `Stripe` instance is constructed once when the module is first imported, reading `process.env.STRIPE_SECRET_KEY` at that moment. This means:

1. **Untestable in isolation.** Every test that imports this route file will attempt to instantiate a real `Stripe` client. There is no seam to swap in a mock — the module is self-wiring its own dependency. Tests must set environment variables before import, which is fragile and ordering-dependent.

2. **No support for secret rotation.** DevDigest has an explicit `SecretsProvider` and `container.invalidateSecretCaches()` pattern precisely because secrets change. The module-scoped singleton ignores this entirely; rotating the Stripe key requires a process restart.

3. **Hidden coupling to `process.env`.** The rest of the codebase routes all secrets through `SecretsProvider` (rule: "Secrets live in `~/.devdigest/secrets.json` (mode 0600), never in env config... All access through `SecretsProvider`"). This module breaks that convention.

**The pattern that fixes it — a proper port/adapter abstraction:**

The correct fix is not simply "inject the `Stripe` client." That would inject a vendor SDK object directly, which is still infrastructure bleeding into the application contract. The correct pattern (as established by `GitHubClient`, `LLMProvider`, etc.) is:

1. **Define a `PaymentProvider` port interface** in the domain or application layer:
   ```typescript
   // modules/billing/domain/ports.ts
   export interface PaymentProvider {
     cancelSubscription(externalId: string): Promise<void>;
     createSubscription(customerId: string, priceId: string): Promise<SubscriptionResult>;
     createCustomer(email: string, name: string): Promise<{ id: string }>;
     listInvoices(customerId: string, limit: number): Promise<InvoiceResult[]>;
     createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
     constructWebhookEvent(rawBody: Buffer, signature: string, secret: string): WebhookEvent;
   }
   ```

2. **Implement a `StripePaymentProvider` adapter** in `adapters/stripe/stripe.ts` that wraps the SDK and implements the interface.

3. **Register it in `container.ts`** as an async getter (it needs the `STRIPE_SECRET_KEY` from `SecretsProvider`):
   ```typescript
   async payment(): Promise<PaymentProvider> {
     if (this.overrides.payment) return this.overrides.payment;
     if (this._payment) return this._payment;
     const key = await this.secrets.get('STRIPE_SECRET_KEY');
     this._payment = new StripePaymentProvider(key);
     return this._payment;
   }
   ```

4. **The billing service receives the interface**, never the SDK. Tests inject a `MockPaymentProvider` via `ContainerOverrides`.

---

## Issue 3 — Webhook Handler: Three Business Events, Wrong Structure [HIGH]

The webhook handler (lines 137-183) handles three distinct event types in a single route handler:

| Event | Business Meaning |
|-------|-----------------|
| `customer.subscription.updated` | Plan change, renewal, status update |
| `customer.subscription.deleted` | Cancellation confirmed by Stripe |
| `invoice.payment_failed` | Failed charge — triggers dunning flow |

**Why this is the wrong structure:**

1. **Three separate use cases are merged.** Each event type is an independent business operation with its own failure modes, retry semantics, and side effects. Subscription deletion and payment failure are not the same concern.

2. **All three share a `reply.send({ received: true })` regardless of whether inner logic succeeds.** If the DB update for `subscription.updated` throws, Stripe receives a 500 and will retry. That is correct behavior — but the current code has no try/catch around the inner handlers, so any failure aborts the entire handler and Stripe retries all three event types again.

3. **No event routing abstraction.** As the billing module grows (trial expiration, refunds, dispute events, etc.) every new case gets another `if` block in this handler.

**Correct structure:** A thin route handler that delegates to an application-layer `WebhookService.handle(event)`, which dispatches to per-event-type use cases:

```typescript
// routes.ts — presentation layer
app.post('/billing/webhook', async (req, reply) => {
  const event = await paymentProvider.constructWebhookEvent(req.rawBody, sig, secret);
  await webhookService.handle(event);  // single delegation
  return reply.send({ received: true });
});

// service.ts — application layer
class BillingWebhookService {
  async handle(event: WebhookEvent): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.updated': return this.onSubscriptionUpdated(event.data);
      case 'customer.subscription.deleted': return this.onSubscriptionDeleted(event.data);
      case 'invoice.payment_failed':        return this.onPaymentFailed(event.data);
      // unknown events: no-op (idempotent)
    }
  }
}
```

Each `on*` method is a testable use case. The route handler stays under 10 lines.

---

## Issue 4 — Correct Port/Adapter Abstraction for Stripe [MEDIUM]

(Expanding on Issue 2's fix with the full reasoning.)

"Just inject the Stripe client" is an incomplete fix. Injecting `Stripe` (the SDK class) as a constructor parameter would still mean:

- The service depends on the SDK's concrete type and its method signatures
- Any future payment provider (Paddle, PayPal) requires rewriting the service
- Mocking requires a deep stub of the Stripe SDK

The correct abstraction is a **domain-defined port** (`PaymentProvider` interface) that expresses **what billing needs**, not **how Stripe works**. The interface should use domain vocabulary (`cancelSubscription`, `createPortalSession`) and domain types (`SubscriptionResult`, `WebhookEvent`) — not Stripe SDK types like `Stripe.Subscription` or `Stripe.Invoice`.

The `StripePaymentProvider` adapter (infrastructure layer) translates between the domain vocabulary and Stripe's API. If Stripe changes an API or the team switches providers, only the adapter changes. The service, domain, and tests are untouched.

This follows the identical pattern already established in DevDigest for `GitHubClient`/`OctokitGitHubClient` and `LLMProvider`/`OpenAIProvider`.

**Layers for the billing module:**
```
Domain:         PaymentProvider (interface), Subscription (entity), Invoice (entity)
Application:    BillingService, BillingWebhookService (use cases)
Infrastructure: StripePaymentProvider, DrizzleBillingRepository
Presentation:   routes.ts (thin handlers delegating to services)
```

---

## Issue 5 — /billing/invoices GET: HTTP Contract Violation [HIGH]

```typescript
// routes.ts lines 118-134
const toUpsert = stripeInvoices.data.map(inv => ({ ... }));

if (toUpsert.length > 0) {
  await db.insert(invoices).values(toUpsert).onConflictDoNothing();  // DB WRITE in GET!
}

return reply.send({ invoices: stripeInvoices.data });  // Returns raw Stripe objects
```

**HTTP contract violation: GET must be safe and idempotent.** RFC 9110 Section 9.2 defines "safe" methods as those that do not have any side effects on the server. A GET request that performs a database write violates this contract.

**Why it matters:**

1. **Caches will serve stale responses.** Any HTTP cache (CDN, browser, reverse proxy) is permitted to cache GET responses and serve them without hitting the origin. When the cache serves a cached response, the DB write never happens, producing inconsistent local state relative to what the UI received.

2. **Monitoring and observability tools are confused.** Read-only health checks, load balancers, and crawlers may issue GET requests. Each would trigger a DB write.

3. **Retry-on-failure is unsafe.** When a GET request fails, clients retry. Each retry causes another insert attempt (mitigated by `onConflictDoNothing`, but the write still occurs).

4. **The response returns raw `stripeInvoices.data`** (Stripe SDK objects), bypassing the locally written `toUpsert` records entirely. The invoice sync to DB and the response are disconnected — the DB is being written as a side effect of reading, with no guarantee the persisted shape matches the returned shape.

**Fix:** Separate concerns. Invoices should be synced to the DB by the webhook handler (`invoice.payment_succeeded` / `invoice.payment_failed` events from Stripe) or by an explicit background sync job. The GET handler should read from the local DB only (or from Stripe only, without a side-effect write). It should never do both.

---

## Additional Violations (Not in the Five Required Issues)

### Fat Controller — All Logic in routes.ts [CRITICAL]

Every handler contains: direct DB queries (`import { eq, and, desc } from 'drizzle-orm'`), Stripe API calls, business logic, and error handling. There is no service layer, no repository layer, no domain layer. This is the **Fat Controller** anti-pattern described in `anti-patterns.md` Section 3 applied to all six handlers.

**Immediate consequence:** Adding a second trigger point for any billing operation (e.g., a webhook, a background job, an admin endpoint) requires duplicating all this logic.

### (req.user as any) — Missing Type Safety [MEDIUM]

```typescript
const userId = (req.user as any).id;
```

Repeated in every handler. This bypasses TypeScript's type system. In DevDigest's auth pattern, `req.user` should be typed via Fastify's `TypeProvider` or a declared augmentation. If the auth decorator ever changes the shape of `req.user`, this code silently fails at runtime.

### STRIPE_WEBHOOK_SECRET from process.env [MEDIUM]

```typescript
process.env.STRIPE_WEBHOOK_SECRET!
```

Like `STRIPE_SECRET_KEY`, this bypasses `SecretsProvider`. Both should be fetched via `await container.secrets.get('STRIPE_WEBHOOK_SECRET')`.

---

## Recommended Refactoring Plan

**Phase 1 — Stop the bleeding (before next sprint ends):**
1. Fix `/billing/cancel` to use webhook-driven DB updates (eliminates Issue 1)
2. Move GET /billing/invoices to read-only; remove DB write from handler (fixes Issue 5)

**Phase 2 — Introduce service layer (next sprint):**
3. Create `BillingService` with use cases: `getSubscription`, `subscribe`, `cancel`, `getPortalUrl`
4. Create `BillingWebhookService` with per-event handlers
5. Routes become thin (validate → delegate → respond)

**Phase 3 — Introduce port/adapter (sprint +2):**
6. Define `PaymentProvider` interface in domain layer
7. Implement `StripePaymentProvider` adapter
8. Register in `container.ts` with `SecretsProvider`
9. Add `MockPaymentProvider` in `adapters/mocks.ts`
10. Write unit tests for `BillingService` using the mock

---

## Summary Table

| Issue | Severity | Handler | Violation |
|-------|----------|---------|-----------|
| Stripe succeeds, DB fails — no compensation | CRITICAL | POST /billing/cancel | No saga/outbox; split-brain state |
| Module-scope Stripe singleton | HIGH | All handlers | No injection seam; bypasses SecretsProvider |
| Webhook handles 3 events in one handler | HIGH | POST /billing/webhook | Missing use-case decomposition |
| No PaymentProvider port abstraction | MEDIUM | All handlers | Infrastructure in presentation layer |
| GET performs DB write | HIGH | GET /billing/invoices | Violates HTTP safe method semantics |
| Fat controller — all layers collapsed | CRITICAL | All handlers | Anti-pattern 3 in anti-patterns.md |
| `(req.user as any)` | MEDIUM | All handlers | Type safety bypass |
| Secrets from process.env | MEDIUM | All handlers | Bypasses SecretsProvider convention |
