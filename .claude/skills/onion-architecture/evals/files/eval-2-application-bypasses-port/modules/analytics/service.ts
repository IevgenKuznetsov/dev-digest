import { AnalyticsRepository } from './repository';
import type { DashboardStats, PageView } from './domain/types';

export class AnalyticsService {
  private repo: AnalyticsRepository;

  constructor() {
    this.repo = new AnalyticsRepository();
  }

  async trackView(
    path: string,
    sessionId: string,
    userId: string | null,
    durationMs: number,
    referrer: string | null,
  ): Promise<void> {
    const view: PageView = {
      path,
      sessionId,
      userId,
      durationMs,
      referrer,
      timestamp: new Date(),
    };
    await this.repo.record(view);
  }

  async getDashboard(days: number = 30): Promise<DashboardStats> {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    return this.repo.getDashboardStats(fromDate);
  }

  async getRecentActivity(limit: number = 50): Promise<PageView[]> {
    return this.repo.getRecentViews(limit);
  }
}
