import type { BriefRiskLevel } from "@devdigest/shared";

/** Color palette for risk level badges (color + background). */
export const RISK_LEVEL_COLORS: Record<BriefRiskLevel, { color: string; bg: string }> = {
  low: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  medium: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
  high: { color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  critical: { color: "#f87171", bg: "rgba(248,113,113,0.12)" },
};

/**
 * Display labels for each risk level.
 * REQ-46/GAP-4: Badge must render text label, not color-only.
 */
export const RISK_LEVEL_LABELS: Record<BriefRiskLevel, string> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
  critical: "CRITICAL",
};
