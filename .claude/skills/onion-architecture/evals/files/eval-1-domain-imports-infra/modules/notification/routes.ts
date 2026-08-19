import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotificationService } from './domain/NotificationService';

const service = new NotificationService();

const markReadSchema = z.object({
  notificationId: z.string().uuid(),
});

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications', async (req, reply) => {
    const userId = (req.user as any).id;
    const items = await service.getUnread(userId);
    return reply.send({ notifications: items });
  });

  app.get('/notifications/count', async (req, reply) => {
    const userId = (req.user as any).id;
    const count = await service.getUnreadCount(userId);
    return reply.send({ count });
  });

  app.post('/notifications/:id/read', async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = (req.user as any).id;
    await service.markRead(id, userId);
    return reply.send({ ok: true });
  });

  app.post('/notifications/mark-all-read', async (req, reply) => {
    const userId = (req.user as any).id;
    await service.markAllRead(userId);
    return reply.send({ ok: true });
  });

  app.delete('/notifications/old', async (req, reply) => {
    const userId = (req.user as any).id;
    const days = Number((req.query as any).days) || 30;
    const removed = await service.deleteOld(userId, days);
    return reply.send({ removed });
  });
}
