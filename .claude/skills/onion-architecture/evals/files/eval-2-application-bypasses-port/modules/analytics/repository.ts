import { sql, gte, desc } from 'drizzle-orm';
import { db } from '../../db';
import { pageViews } from '../../db/schema';
import type { PageView, DashboardStats, RetentionRow } from './domain/types';

export class AnalyticsRepository {
  async record(view: PageView): Promise<void> {
    await db.insert(pageViews).values({
      path: view.path,
      userId: view.userId,
      sessionId: view.sessionId,
      timestamp: view.timestamp,
      durationMs: view.durationMs,
      referrer: view.referrer,
    });
  }

  async getDashboardStats(fromDate: Date): Promise<DashboardStats> {
    const rows = await db
      .select()
      .from(pageViews)
      .where(gte(pageViews.timestamp, fromDate));

    const totalViews = rows.length;
    const uniqueSessions = new Set(rows.map(r => r.sessionId)).size;
    const uniqueUsers = new Set(rows.filter(r => r.userId).map(r => r.userId)).size;
    const avgDurationMs = totalViews > 0
      ? rows.reduce((sum, r) => sum + r.durationMs, 0) / totalViews
      : 0;

    const sessionPageCounts: Record<string, number> = {};
    rows.forEach(r => { sessionPageCounts[r.sessionId] = (sessionPageCounts[r.sessionId] || 0) + 1; });
    const bounces = Object.values(sessionPageCounts).filter(c => c === 1).length;
    const bounceRate = uniqueSessions > 0 ? bounces / uniqueSessions : 0;

    const pathStats: Record<string, { views: number; totalDuration: number }> = {};
    rows.forEach(r => {
      if (!pathStats[r.path]) pathStats[r.path] = { views: 0, totalDuration: 0 };
      pathStats[r.path].views++;
      pathStats[r.path].totalDuration += r.durationMs;
    });
    const topPages = Object.entries(pathStats)
      .map(([path, s]) => ({ path, views: s.views, avgDurationMs: s.totalDuration / s.views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    return { totalViews, uniqueSessions, uniqueUsers, avgDurationMs, bounceRate, topPages };
  }

  async getRecentViews(limit: number): Promise<PageView[]> {
    const rows = await db
      .select()
      .from(pageViews)
      .orderBy(desc(pageViews.timestamp))
      .limit(limit);
    return rows.map(r => ({
      path: r.path,
      userId: r.userId,
      sessionId: r.sessionId,
      timestamp: r.timestamp,
      durationMs: r.durationMs,
      referrer: r.referrer,
    }));
  }
}
