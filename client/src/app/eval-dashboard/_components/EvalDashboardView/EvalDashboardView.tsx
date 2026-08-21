/* EvalDashboardView — workspace-wide eval dashboard. Agent cards + recent runs table. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Icon, ProgressBar, Skeleton } from "@devdigest/ui";
import type { EvalWorkspaceDashboard } from "@devdigest/shared";
import { AgentEvalCard } from "../AgentEvalCard";
import { s } from "./styles";

function formatPercent(v: number | null | undefined): string {
  if (v == null) return "—";
  return (v * 100).toFixed(1) + "%";
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCost(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toFixed(4)}`;
}

function MetricBar({ value }: { value: number | null | undefined }) {
  const pct = value != null ? Math.round(value * 100) : 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 52, display: "inline-block" }}>
        <ProgressBar value={pct} height={5} />
      </span>
      <span className="tnum" style={{ fontSize: 12, minWidth: 36 }}>
        {formatPercent(value)}
      </span>
    </span>
  );
}

export function EvalDashboardView({
  data,
  isLoading,
}: {
  data: EvalWorkspaceDashboard | undefined;
  isLoading: boolean;
}) {
  const router = useRouter();

  if (isLoading) {
    return (
      <div style={s.page}>
        <div style={s.headerRow}>
          <h1 style={s.h1}>Eval Dashboard</h1>
        </div>
        <Skeleton height={160} />
        <Skeleton height={200} />
      </div>
    );
  }

  const agents = data?.agents ?? [];
  const recentBatches = data?.recent_batches ?? [];

  return (
    <div style={s.page}>
      <div style={s.headerRow}>
        <h1 style={s.h1}>Eval Dashboard</h1>
      </div>

      {/* Agent cards grid */}
      <div>
        <div style={s.sectionLabel}>Agents</div>
        {agents.length === 0 ? (
          <p style={s.emptyNote}>No agents with eval data yet. Create eval cases from the agent editor.</p>
        ) : (
          <div style={s.agentGrid}>
            {agents.map((summary) => (
              <AgentEvalCard
                key={summary.agent_id}
                summary={summary}
                onClick={() => router.push(`/eval-dashboard?agent=${summary.agent_id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent runs table */}
      {recentBatches.length > 0 && (
        <div>
          <div style={s.sectionLabel}>Recent Eval Runs</div>
          <table style={s.table} aria-label="Recent eval runs">
            <thead>
              <tr>
                <th style={s.th}>Agent</th>
                <th style={s.th}>Ran at</th>
                <th style={s.th}>Version</th>
                <th style={s.th}>Recall</th>
                <th style={s.th}>Precision</th>
                <th style={s.th}>Citation</th>
                <th style={s.th}>Pass rate</th>
                <th style={s.th}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {recentBatches.map((batch) => {
                const passRate =
                  batch.traces_total != null && batch.traces_total > 0 && batch.traces_passed != null
                    ? batch.traces_passed / batch.traces_total
                    : null;
                const passed = passRate != null ? passRate >= 0.5 : null;
                return (
                  <tr key={batch.id}>
                    <td style={s.td}>{(batch as typeof batch & { agent_name?: string | null }).agent_name ?? "—"}</td>
                    <td style={s.td}>{formatDate(batch.ran_at)}</td>
                    <td style={s.td}>v{batch.agent_version}</td>
                    <td style={s.td}><MetricBar value={batch.recall} /></td>
                    <td style={s.td}><MetricBar value={batch.precision} /></td>
                    <td style={s.td}><MetricBar value={batch.citation_accuracy} /></td>
                    <td style={s.td}>
                      {/* Pass/fail: icon + text, not color alone (accessibility) */}
                      {passed !== null ? (
                        <div style={s.passCell(passed)}>
                          {passed
                            ? <><Icon.CheckCircle size={13} aria-hidden="true" /><span>Pass</span></>
                            : <><Icon.XCircle size={13} aria-hidden="true" /><span>Fail</span></>
                          }
                          <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>
                            ({batch.traces_passed}/{batch.traces_total})
                          </span>
                        </div>
                      ) : "—"}
                    </td>
                    <td style={s.td}>{formatCost(batch.cost_usd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
