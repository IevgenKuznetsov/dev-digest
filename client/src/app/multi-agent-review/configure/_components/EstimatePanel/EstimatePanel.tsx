/* EstimatePanel — displays aggregate and per-agent pre-run cost/duration estimates. */
"use client";

import React from "react";
import type { AgentEstimate } from "@devdigest/shared";

const s = {
  panel: {
    padding: "16px 20px",
    borderRadius: 8,
    border: "1px solid var(--border-subtle)",
    backgroundColor: "var(--surface-2)",
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    letterSpacing: "0.05em",
    marginBottom: 12,
    textTransform: "uppercase" as const,
  },
  aggregate: {
    display: "flex",
    gap: 24,
    marginBottom: 16,
    flexWrap: "wrap" as const,
  },
  stat: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  statLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  statValue: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums" as const,
  },
  partialNote: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
    marginBottom: 12,
  },
  breakdown: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  breakdownRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 12,
    gap: 12,
  },
  agentName: {
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    flex: 1,
    minWidth: 0,
  },
  agentStats: {
    display: "flex",
    gap: 16,
    flexShrink: 0,
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums" as const,
  },
  emptyNote: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
  },
  divider: {
    height: 1,
    backgroundColor: "var(--border-subtle)",
    margin: "12px 0",
  },
};

function formatCost(v: number | null): string {
  if (v == null) return "?";
  if (v === 0) return "$0.00";
  if (v < 0.001) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(4)}`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "?";
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

interface EstimatePanelProps {
  /** Estimates for only the selected agents — filtered by parent */
  selectedEstimates: AgentEstimate[];
  totalCostUsd: number | null;
  totalDurationMs: number | null;
  isPartial: boolean;
}

export function EstimatePanel({
  selectedEstimates,
  totalCostUsd,
  totalDurationMs,
  isPartial,
}: EstimatePanelProps) {
  const allEmpty = selectedEstimates.length === 0;
  const allNoData =
    !allEmpty &&
    selectedEstimates.every((e) => e.cost_usd == null && e.duration_ms == null);

  return (
    <div style={s.panel} aria-label="Pre-run estimate panel">
      <div style={s.title}>Pre-run Estimate</div>

      {allEmpty ? (
        <p style={s.emptyNote}>Select agents to see an estimate.</p>
      ) : allNoData ? (
        <p style={s.emptyNote}>
          No historical data available. Estimates will improve after the first run.
        </p>
      ) : (
        <>
          {/* Aggregate stats */}
          <div style={s.aggregate}>
            <div style={s.stat}>
              <span style={s.statLabel}>Est. Cost</span>
              <span style={s.statValue}>{formatCost(totalCostUsd)}</span>
            </div>
            <div style={s.stat}>
              <span style={s.statLabel}>Est. Duration</span>
              <span style={s.statValue}>{formatDuration(totalDurationMs)}</span>
            </div>
          </div>

          {isPartial && (
            <p style={s.partialNote}>
              * Partial estimate — some agents have no historical data (?).
            </p>
          )}

          <div style={s.divider} />

          {/* Per-agent breakdown */}
          <div style={s.breakdown} aria-label="Per-agent breakdown">
            {selectedEstimates.map((est) => (
              <div key={est.agent_id} style={s.breakdownRow}>
                <span style={s.agentName}>{est.agent_name}</span>
                <div style={s.agentStats}>
                  <span>{formatCost(est.cost_usd)}</span>
                  <span>{formatDuration(est.duration_ms)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
