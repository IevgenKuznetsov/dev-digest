import { eq, and } from 'drizzle-orm';
import { db } from '../../../db';
import { notifications } from '../../../db/schema';

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export class NotificationService {
  async getUnread(userId: string): Promise<Notification[]> {
    return db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
      .orderBy(notifications.createdAt);
  }

  async getUnreadCount(userId: string): Promise<number> {
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
    return rows.length;
  }

  async markRead(notificationId: string, userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
  }

  async markAllRead(userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  }

  async create(userId: string, title: string, body: string): Promise<string> {
    const [row] = await db
      .insert(notifications)
      .values({ userId, title, body, read: false, readAt: null, createdAt: new Date() })
      .returning({ id: notifications.id });
    return row.id;
  }

  async deleteOld(userId: string, olderThanDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const deleted = await db
      .delete(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, true)))
      .returning({ id: notifications.id });
    return deleted.length;
  }
}
