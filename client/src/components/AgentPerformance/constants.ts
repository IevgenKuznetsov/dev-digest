/* AgentPerformance/constants.ts — dashboard window options + donut palette. */
import type { PerfWindow } from "@devdigest/shared";

export const WINDOW_OPTIONS: { key: PerfWindow; label: string }[] = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
];

export const DEFAULT_WINDOW: PerfWindow = "30";

/** Palette cycled by slice index for the by-agent / by-model cost donuts. */
export const DONUT_PALETTE = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];
