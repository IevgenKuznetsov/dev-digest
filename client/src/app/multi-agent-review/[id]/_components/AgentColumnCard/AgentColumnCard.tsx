/* AgentColumnCard — renders one agent's result column in the multi-agent results page. */
"use client";

import React from "react";
import type { MultiAgentAgentColumn } from "@devdigest/shared";
import { formatCost, formatDuration, formatElapsed, computeElapsed } from "../ResultsView/helpers";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "var(--severity-critical, #ef4444)",
  WARNING: "var(--severity-warning, #f59e0b)",
  SUGGESTION: "var(--severity-suggestion, #3b82f6)",
};

const STATUS_INDICATOR: Record<string, { color: string; label: string }> = {
  running: { color: "var(--accent)", label: "Running" },
  done: { color: "var(--success, #22c55e)", label: "Done" },
  failed: { color: "var(--error, #ef4444)", label: "Failed" },
};

const s = {
  card: {
    display: "flex",
    flexDirection: "column" as const,
    borderRadius: 8,
    border: "1px solid var(--border-subtle)",
    backgroundColor: "var(--surface-2)",
    overflow: "hidden",
    minWidth: 260,
    flex: "0 0 300px",
  },
  cardFailed: {
    borderColor: "var(--error, #ef4444)",
  },
  header: {
    padding: "14px 16px",
    borderBottom: "1px solid var(--border-subtle)",
    backgroundColor: "var(--surface-3)",
  },
  agentName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  modelBadge: {
    fontSize: 11,
    color: "var(--text-muted)",
    fontFamily: "monospace",
    marginBottom: 8,
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  statusDot: (status: string) => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: STATUS_INDICATOR[status]?.color ?? "var(--text-muted)",
    flexShrink: 0,
  }),
  statusLabel: {
    fontSize: 12,
    color: "var(--text-secondary)",
  },
  connectionLost: {
    fontSize: 11,
    color: "var(--warning, #f59e0b)",
    marginLeft: "auto",
  },
  statsRow: {
    display: "flex",
    gap: 12,
    marginTop: 8,
    flexWrap: "wrap" as const,
  },
  stat: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 1,
  },
  statLabel: {
    fontSize: 10,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  statValue: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums" as const,
  },
  body: {
    padding: "14px 16px",
    flex: 1,
    overflow: "auto",
  },
  verdictBadge: (verdict: string | null) => ({
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    backgroundColor:
      verdict === "approved"
        ? "var(--success-subtle, rgba(34,197,94,0.12))"
        : verdict === "changes_requested"
          ? "var(--error-subtle, rgba(239,68,68,0.12))"
          : "var(--surface-3)",
    color:
      verdict === "approved"
        ? "var(--success, #22c55e)"
        : verdict === "changes_requested"
          ? "var(--error, #ef4444)"
          : "var(--text-muted)",
    marginBottom: 10,
  }),
  scoreRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  score: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  summary: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 12,
  },
  findingsLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: 6,
  },
  findingRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "6px 0",
    borderBottom: "1px solid var(--border-subtle)",
  },
  severityBadge: (severity: string) => ({
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 5px",
    borderRadius: 3,
    flexShrink: 0,
    backgroundColor:
      severity === "CRITICAL"
        ? "rgba(239,68,68,0.12)"
        : severity === "WARNING"
          ? "rgba(245,158,11,0.12)"
          : "rgba(59,130,246,0.12)",
    color: SEVERITY_COLORS[severity] ?? "var(--text-muted)",
  }),
  findingTitle: {
    fontSize: 12,
    color: "var(--text-primary)",
    flex: 1,
    minWidth: 0,
  },
  errorBox: {
    padding: "12px 14px",
    borderRadius: 6,
    backgroundColor: "var(--error-subtle, rgba(239,68,68,0.08))",
    border: "1px solid var(--error-border, rgba(239,68,68,0.2))",
    fontSize: 13,
    color: "var(--error, #ef4444)",
  },
  spinner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    flexDirection: "column" as const,
    gap: 8,
  },
  spinnerText: {
    fontSize: 13,
    color: "var(--text-muted)",
  },
};

interface AgentColumnCardProps {
  column: MultiAgentAgentColumn;
  connectionLost?: boolean;
  elapsed?: number;
}

export function AgentColumnCard({ column, connectionLost, elapsed }: AgentColumnCardProps) {
  const isFailed = column.status === "failed";
  const isRunning = column.status === "running";

  return (
    <section
      style={{ ...s.card, ...(isFailed ? s.cardFailed : {}) }}
      aria-label={`${column.agent_name} review column`}
    >
      {/* Header */}
      <header style={s.header}>
        <div style={s.agentName}>{column.agent_name}</div>
        <div style={s.modelBadge}>
          {column.provider && `${column.provider} · `}
          {column.model ?? "—"}
        </div>

        <div style={s.statusRow}>
          <span style={s.statusDot(column.status)} aria-hidden="true" />
          <span style={s.statusLabel}>
            {STATUS_INDICATOR[column.status]?.label ?? column.status}
            {isRunning && elapsed != null && ` · ${formatElapsed(elapsed)}`}
          </span>
          {connectionLost && (
            <span style={s.connectionLost} role="status">
              ⚠ Connection lost
            </span>
          )}
        </div>

        {/* Stats (shown when done or failed to show partial data) */}
        {column.status !== "running" && (
          <div style={s.statsRow}>
            {column.duration_ms != null && (
              <div style={s.stat}>
                <span style={s.statLabel}>Duration</span>
                <span style={s.statValue}>{formatDuration(column.duration_ms)}</span>
              </div>
            )}
            {(column.tokens_in != null || column.tokens_out != null) && (
              <div style={s.stat}>
                <span style={s.statLabel}>Tokens</span>
                <span style={s.statValue}>
                  {column.tokens_in ?? "—"} / {column.tokens_out ?? "—"}
                </span>
              </div>
            )}
            {column.cost_usd != null && (
              <div style={s.stat}>
                <span style={s.statLabel}>Cost</span>
                <span style={s.statValue}>{formatCost(column.cost_usd)}</span>
              </div>
            )}
            {column.findings.length > 0 && (
              <div style={s.stat}>
                <span style={s.statLabel}>Findings</span>
                <span style={s.statValue}>{column.findings.length}</span>
              </div>
            )}
            {column.score != null && (
              <div style={s.stat}>
                <span style={s.statLabel}>Score</span>
                <span style={s.statValue}>{column.score}/100</span>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Body */}
      <div style={s.body}>
        {isRunning ? (
          <div style={s.spinner} role="status" aria-label={`${column.agent_name} is running`}>
            <span style={s.spinnerText}>Running…</span>
          </div>
        ) : isFailed ? (
          <div style={s.errorBox} role="alert">
            <strong>Review failed.</strong>
            {column.summary && <p style={{ marginTop: 6 }}>{column.summary}</p>}
          </div>
        ) : (
          <>
            {column.verdict && (
              <div style={s.verdictBadge(column.verdict)}>
                {column.verdict.replace("_", " ")}
              </div>
            )}

            {column.score != null && (
              <div style={s.scoreRow}>
                <span style={s.score}>{column.score}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>/100</span>
              </div>
            )}

            {column.summary && <p style={s.summary}>{column.summary}</p>}

            {column.findings.length > 0 && (
              <>
                <div style={s.findingsLabel}>
                  {column.findings.length} finding{column.findings.length !== 1 ? "s" : ""}
                </div>
                {column.findings.map((f) => (
                  <div key={f.id} style={s.findingRow}>
                    <span style={s.severityBadge(f.severity)}>{f.severity}</span>
                    <span style={s.findingTitle}>{f.title}</span>
                  </div>
                ))}
              </>
            )}

            {column.findings.length === 0 && !column.summary && (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No findings.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// Re-export helpers so callers who import AgentColumnCard can also use formatElapsed/computeElapsed
export { computeElapsed, formatElapsed };
