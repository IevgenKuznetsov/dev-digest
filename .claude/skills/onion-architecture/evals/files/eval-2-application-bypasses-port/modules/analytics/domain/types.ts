export interface PageView {
  path: string;
  userId: string | null;
  sessionId: string;
  timestamp: Date;
  durationMs: number;
  referrer: string | null;
}

export interface DashboardStats {
  totalViews: number;
  uniqueSessions: number;
  uniqueUsers: number;
  avgDurationMs: number;
  bounceRate: number;
  topPages: Array<{ path: string; views: number; avgDurationMs: number }>;
}

export interface RetentionRow {
  cohortDate: string;
  day0: number;
  day1: number;
  day7: number;
  day30: number;
}
