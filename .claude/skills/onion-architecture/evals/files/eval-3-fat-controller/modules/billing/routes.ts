import { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '../../db';
import { subscriptions, invoices, users } from '../../db/schema';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });

export async function billingRoutes(app: FastifyInstance) {
  app.get('/billing/subscription', async (req, reply) => {
    const userId = (req.user as any).id;

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));

    if (!sub) {
      return reply.send({ active: false, plan: null, daysLeft: 0 });
    }

    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeId);

    const isActive = stripeSub.status === 'active' || stripeSub.status === 'trialing';
    const daysLeft = Math.floor(
      (stripeSub.current_period_end * 1000 - Date.now()) / (1000 * 60 * 60 * 24),
    );
    const planName = stripeSub.items.data[0]?.price.nickname ?? null;

    return reply.send({ active: isActive, plan: planName, daysLeft });
  });

  app.post('/billing/subscribe', async (req, reply) => {
    const userId = (req.user as any).id;
    const { priceId } = req.body as { priceId: string };

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return reply.status(404).send({ error: 'User not found' });

    let customerId: string;
    const [existingSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));

    if (existingSub?.stripeCustomerId) {
      customerId = existingSub.stripeCustomerId;
    } else {
      const customer = await stripe.customers.create({ email: user.email, name: user.name });
      customerId = customer.id;
    }

    const stripeSub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    await db.insert(subscriptions).values({
      userId,
      stripeId: stripeSub.id,
      stripeCustomerId: customerId,
      status: stripeSub.status,
      priceId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: subscriptions.userId,
      set: { stripeId: stripeSub.id, status: stripeSub.status, updatedAt: new Date() },
    });

    const invoice = stripeSub.latest_invoice as any;
    const clientSecret = invoice?.payment_intent?.client_secret;

    return reply.send({ subscriptionId: stripeSub.id, clientSecret });
  });

  app.post('/billing/cancel', async (req, reply) => {
    const userId = (req.user as any).id;

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));

    if (!sub) return reply.status(404).send({ error: 'No subscription found' });

    await stripe.subscriptions.cancel(sub.stripeId);

    await db
      .update(subscriptions)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));

    const [user] = await db.select().from(users).where(eq(users.id, userId));

    app.log.info(`Subscription cancelled for ${user.email}`);

    return reply.send({ cancelled: true });
  });

  app.get('/billing/invoices', async (req, reply) => {
    const userId = (req.user as any).id;

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));

    if (!sub) return reply.send({ invoices: [] });

    const stripeInvoices = await stripe.invoices.list({
      customer: sub.stripeCustomerId,
      limit: 24,
    });

    const toUpsert = stripeInvoices.data.map(inv => ({
      userId,
      stripeId: inv.id,
      amountCents: inv.amount_paid,
      currency: inv.currency,
      status: inv.status ?? 'unknown',
      pdfUrl: inv.invoice_pdf ?? null,
      periodStart: new Date(inv.period_start * 1000),
      periodEnd: new Date(inv.period_end * 1000),
      createdAt: new Date(inv.created * 1000),
    }));

    if (toUpsert.length > 0) {
      await db.insert(invoices).values(toUpsert).onConflictDoNothing();
    }

    return reply.send({ invoices: stripeInvoices.data });
  });

  app.post('/billing/webhook', async (req, reply) => {
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody as Buffer,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!,
      );
    } catch {
      return reply.status(400).send({ error: 'Webhook signature verification failed' });
    }

    if (event.type === 'customer.subscription.updated') {
      const stripeSub = event.data.object as Stripe.Subscription;
      await db
        .update(subscriptions)
        .set({ status: stripeSub.status, updatedAt: new Date() })
        .where(eq(subscriptions.stripeId, stripeSub.id));
    }

    if (event.type === 'customer.subscription.deleted') {
      const stripeSub = event.data.object as Stripe.Subscription;
      await db
        .update(subscriptions)
        .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(subscriptions.stripeId, stripeSub.id));
    }

    if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object as Stripe.Invoice;
      const [dbSub] = await db
        .select({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(eq(subscriptions.stripeCustomerId, inv.customer as string));

      if (dbSub) {
        const [user] = await db.select().from(users).where(eq(users.id, dbSub.userId));
        if (user) {
          app.log.warn(`Payment failed for user ${user.email} — trigger dunning flow`);
        }
      }
    }

    return reply.send({ received: true });
  });

  app.get('/billing/portal', async (req, reply) => {
    const userId = (req.user as any).id;

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));

    if (!sub) return reply.status(404).send({ error: 'No subscription' });

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${process.env.APP_URL}/settings/billing`,
    });

    return reply.send({ url: session.url });
  });
}
