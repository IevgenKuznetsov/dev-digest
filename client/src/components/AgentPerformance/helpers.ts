/* AgentPerformance/helpers.ts — pure formatting helpers (no DB, no fetch). */
import type { CostSlice } from "@devdigest/shared";
import { DONUT_PALETTE } from "./constants";

/** Format a USD amount, or "—" when null/undefined. */
export function formatUsd(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${value.toFixed(4)}`;
}

/** Format a signed USD delta, e.g. "+$1.2000" / "-$0.5000", or "—" when null. */
export function formatSignedUsd(value: number | null | undefined): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(4)}`;
}

/** Format a 0-1 fraction as a rounded percent string, or "—" when null. */
export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

/** Format a millisecond duration as seconds, or "—" when null. */
export function formatDurationMs(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${(value / 1000).toFixed(1)}s`;
}

/** Format an ISO date string for display, or "—" when null. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

/**
 * Shape CostSlice rows into DonutSegment-compatible objects (label/value/color),
 * cycling a fixed palette by index. Strings are rendered as inert text by the
 * Donut component — never interpreted as markup (Edge 14).
 */
export function toDonutSegments(
  slices: CostSlice[],
): { label: string; value: number; color: string }[] {
  return slices.map((s, i) => ({
    label: s.key,
    value: s.cost_usd,
    color: DONUT_PALETTE[i % DONUT_PALETTE.length] ?? "#94a3b8",
  }));
}
