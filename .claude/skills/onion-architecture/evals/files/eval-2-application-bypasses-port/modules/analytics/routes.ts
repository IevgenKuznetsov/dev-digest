import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AnalyticsService } from './service';
import { AnalyticsRepository } from './repository';
import { db } from '../../db';
import { pageViews } from '../../db/schema';
import { desc } from 'drizzle-orm';

const trackSchema = z.object({
  path: z.string(),
  sessionId: z.string(),
  durationMs: z.number().int().nonnegative(),
  referrer: z.string().nullable().optional(),
});

export async function analyticsRoutes(app: FastifyInstance) {
  const service = new AnalyticsService();
  const repo = new AnalyticsRepository();

  app.post('/analytics/track', async (req, reply) => {
    const body = trackSchema.parse(req.body);
    const userId = (req.user as any)?.id ?? null;
    await service.trackView(body.path, body.sessionId, userId, body.durationMs, body.referrer ?? null);
    return reply.send({ ok: true });
  });

  app.get('/analytics/dashboard', async (req, reply) => {
    const days = Number((req.query as any).days) || 30;
    const stats = await service.getDashboard(days);
    return reply.send(stats);
  });

  app.get('/analytics/recent', async (req, reply) => {
    const limit = Math.min(Number((req.query as any).limit) || 50, 200);
    const events = await repo.getRecentViews(limit);
    return reply.send({ events });
  });

  app.get('/analytics/live', async (req, reply) => {
    const rows = await db
      .select()
      .from(pageViews)
      .orderBy(desc(pageViews.timestamp))
      .limit(10);
    return reply.send({ live: rows });
  });
}
