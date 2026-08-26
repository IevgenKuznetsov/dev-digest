import type { MultiAgentAgentColumn } from "@devdigest/shared";

/** True when every agent column has completed (status is not 'running'). */
export function isRunComplete(columns: MultiAgentAgentColumn[]): boolean {
  if (columns.length === 0) return false;
  return columns.every((c) => c.status !== "running");
}

/** True when every agent column has failed. */
export function allRunsFailed(columns: MultiAgentAgentColumn[]): boolean {
  if (columns.length === 0) return false;
  return columns.every((c) => c.status === "failed");
}

/**
 * Compute elapsed milliseconds since the given ISO timestamp.
 * Returns 0 if ranAt is null/undefined or cannot be parsed.
 */
export function computeElapsed(ranAt: string | null | undefined): number {
  if (!ranAt) return 0;
  const start = Date.parse(ranAt);
  if (isNaN(start)) return 0;
  return Math.max(0, Date.now() - start);
}

/** Format an elapsed millisecond value as a human-readable string. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

/** Format a cost value. Returns "—" for null. */
export function formatCost(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v === 0) return "$0.00";
  if (v < 0.001) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(4)}`;
}

/** Format a duration in ms. Returns "—" for null. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}
