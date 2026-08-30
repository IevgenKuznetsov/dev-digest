/* AgentPerformanceView — Agent Performance dashboard (AC-E1, AC-E2, AC-ST1).
   Renders TOTAL RUNS, TOTAL COST + signed delta, AVG ACCEPT RATE gauge,
   MOST-ACTIVE AGENT, a per-agent table, and by-agent/by-model cost donuts.
   All agent/model strings render as inert text — never dangerouslySetInnerHTML
   (Edge 14). */
"use client";

import React from "react";
import Link from "next/link";
import { Icon, Skeleton, EmptyState, Donut, PercentProgress } from "@devdigest/ui";
import type { AgentPerformance, CiAgentPerfRow, PerfWindow } from "@devdigest/shared";
import { WINDOW_OPTIONS } from "./constants";
import {
  formatUsd,
  formatSignedUsd,
  formatPercent,
  formatDurationMs,
  formatDate,
  toDonutSegments,
} from "./helpers";

// ---------------------------------------------------------------------------
// WindowSelector
// ---------------------------------------------------------------------------

function WindowSelector({
  window,
  onChange,
}: {
  window: PerfWindow;
  onChange: (w: PerfWindow) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Time window" style={{ display: "flex", gap: 4 }}>
      {WINDOW_OPTIONS.map((opt) => {
        const active = opt.key === window;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.key)}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: active ? "var(--accent)" : "transparent",
              color: active ? "#fff" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value?: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "16px 20px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          letterSpacing: "0.04em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children ?? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 26, fontWeight: 700 }}>{value}</span>
          {sub && <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{sub}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCards — TOTAL RUNS, TOTAL COST + delta, AVG ACCEPT RATE gauge,
// MOST-ACTIVE AGENT
// ---------------------------------------------------------------------------

function StatCards({ data }: { data: AgentPerformance }) {
  const deltaText = formatSignedUsd(data.cost_delta_usd);
  const deltaColor =
    data.cost_delta_usd == null
      ? "var(--text-muted)"
      : data.cost_delta_usd > 0
        ? "var(--error, #ef4444)"
        : data.cost_delta_usd < 0
          ? "var(--ok, #22c55e)"
          : "var(--text-muted)";

  return (
    <div style={{ display: "flex", gap: 16 }}>
      <StatCard label="TOTAL RUNS" value={`${data.total_runs}`} />
      <StatCard label="TOTAL COST">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 26, fontWeight: 700 }}>{formatUsd(data.total_cost_usd)}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: deltaColor }}>{deltaText}</span>
        </div>
      </StatCard>
      <StatCard label="AVG ACCEPT RATE">
        {data.avg_accept_rate == null ? (
          <span style={{ fontSize: 26, fontWeight: 700 }}>—</span>
        ) : (
          <PercentProgress value={data.avg_accept_rate * 100} />
        )}
      </StatCard>
      <StatCard label="MOST-ACTIVE AGENT">
        {data.most_active_agent ? (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{data.most_active_agent.agent_name}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {data.most_active_agent.runs} runs
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 26, fontWeight: 700 }}>—</span>
        )}
      </StatCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CostDonuts — by-agent / by-model cost breakdown
// ---------------------------------------------------------------------------

function CostDonutCard({ title, slices }: { title: string; slices: AgentPerformance["cost_by_agent"] }) {
  const segments = toDonutSegments(slices);
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
        minWidth: 0,
      }}
    >
      <h3
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-muted)",
          marginBottom: 12,
        }}
      >
        {title}
      </h3>
      {segments.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No cost data yet.</p>
      ) : (
        <Donut segments={segments} />
      )}
    </div>
  );
}

function CostDonuts({ data }: { data: AgentPerformance }) {
  return (
    <div style={{ display: "flex", gap: 16 }}>
      <CostDonutCard title="Cost by agent" slices={data.cost_by_agent} />
      <CostDonutCard title="Cost by model" slices={data.cost_by_model} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentPerfTable — per-agent row, with View → agent CI tab (AC-E2)
// ---------------------------------------------------------------------------

function TrendIndicator({ trend }: { trend: CiAgentPerfRow["trend"] }) {
  if (trend === "up") return <Icon.TrendingUp size={14} style={{ color: "var(--ok, #22c55e)" }} />;
  if (trend === "down") return <Icon.TrendingDown size={14} style={{ color: "var(--error, #ef4444)" }} />;
  return <span style={{ color: "var(--text-muted)" }}>—</span>;
}

function AgentPerfRow({ row }: { row: CiAgentPerfRow }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{row.agent_name}</td>
      <td style={{ padding: "10px 12px" }}>{row.runs}</td>
      <td style={{ padding: "10px 12px" }}>{formatUsd(row.avg_cost_usd)}</td>
      <td style={{ padding: "10px 12px" }}>{formatDurationMs(row.avg_duration_ms)}</td>
      <td style={{ padding: "10px 12px" }}>{formatPercent(row.accept_rate)}</td>
      <td style={{ padding: "10px 12px" }}>
        <TrendIndicator trend={row.trend} />
      </td>
      <td style={{ padding: "10px 12px", color: "var(--text-secondary)" }}>
        {formatDate(row.last_run_at)}
      </td>
      <td style={{ padding: "10px 12px" }}>
        <Link
          href={`/agents/${row.agent_id}?tab=ci`}
          style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}
        >
          View
        </Link>
      </td>
    </tr>
  );
}

function AgentPerfTable({ agents }: { agents: CiAgentPerfRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
          <th style={{ padding: "8px 12px", color: "var(--text-muted)", fontWeight: 600 }}>Agent</th>
          <th style={{ padding: "8px 12px", color: "var(--text-muted)", fontWeight: 600 }}>Runs</th>
          <th style={{ padding: "8px 12px", color: "var(--text-muted)", fontWeight: 600 }}>Avg cost</th>
          <th style={{ padding: "8px 12px", color: "var(--text-muted)", fontWeight: 600 }}>Avg duration</th>
          <th style={{ padding: "8px 12px", color: "var(--text-muted)", fontWeight: 600 }}>Accept rate</th>
          <th style={{ padding: "8px 12px", color: "var(--text-muted)", fontWeight: 600 }}>Trend</th>
          <th style={{ padding: "8px 12px", color: "var(--text-muted)", fontWeight: 600 }}>Last run</th>
          <th style={{ padding: "8px 12px" }} />
        </tr>
      </thead>
      <tbody>
        {agents.map((row) => (
          <AgentPerfRow key={row.agent_id} row={row} />
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// AgentPerformanceView — main component
// ---------------------------------------------------------------------------

export function AgentPerformanceView({
  data,
  isLoading,
  window,
  onWindowChange,
}: {
  data: AgentPerformance | undefined;
  isLoading: boolean;
  window: PerfWindow;
  onWindowChange: (w: PerfWindow) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: 28, maxWidth: 1200 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Agent Performance</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
            Aggregated across local and CI-ingested runs.
          </p>
        </div>
        <WindowSelector window={window} onChange={onWindowChange} />
      </div>

      {isLoading || !data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Skeleton height={90} />
          <Skeleton height={220} />
        </div>
      ) : data.total_runs === 0 ? (
        <EmptyState
          icon="Gauge"
          title="No runs in this window"
          body="Once agent runs are recorded locally or ingested from CI, performance data appears here."
        />
      ) : (
        <>
          <StatCards data={data} />
          <CostDonuts data={data} />
          <div
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "auto",
            }}
          >
            <AgentPerfTable agents={data.agents} />
          </div>
        </>
      )}
    </div>
  );
}
