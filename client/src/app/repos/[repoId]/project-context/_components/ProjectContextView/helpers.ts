/** helpers.ts — pure utility functions for ProjectContextView. */

/**
 * Format a date string as a relative human-readable string.
 * Returns "just now", "Xm ago", "Xh ago", or "Xd ago".
 */
export function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
