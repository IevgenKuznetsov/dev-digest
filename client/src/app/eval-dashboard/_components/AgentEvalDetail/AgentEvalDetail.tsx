/* AgentEvalDetail — per-agent drill-down with metric trend chart, runs table, and compare. */
"use client";

import React from "react";
import { Button, MetricCard, Icon, Skeleton, ProgressBar } from "@devdigest/ui";
import type { TimeRangeFilter } from "@devdigest/shared";
import { useAgentEvalDashboard, useStartEvalBatch, useEvalBatches } from "@/lib/hooks/evals";
import { CompareModal } from "../CompareModal";
import { MetricTrendChart } from "../MetricTrendChart";
import { s } from "./styles";
import { TIME_RANGE_OPTIONS } from "./constants";

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

function MetricBarCell({ value }: { value: number | null | undefined }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 48, display: "inline-block" }}>
        <ProgressBar value={value != null ? Math.round(value * 100) : 0} height={5} />
      </span>
      <span className="tnum" style={{ fontSize: 12 }}>{formatPercent(value)}</span>
    </span>
  );
}

export function AgentEvalDetail({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [range, setRange] = React.useState<TimeRangeFilter>("30d");
  const [selectedBatches, setSelectedBatches] = React.useState<string[]>([]);
  const [compareOpen, setCompareOpen] = React.useState(false);

  const { data: dashboard, isLoading } = useAgentEvalDashboard(agentId, range);
  const { data: batches } = useEvalBatches(agentId, range);
  const startBatch = useStartEvalBatch(agentId);

  const batchInProgress = batches?.some(
    (b) => b.status === "queued" || b.status === "running",
  ) ?? false;

  function toggleBatch(id: string) {
    setSelectedBatches((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev.slice(-1), id],
    );
  }

  const canCompare = selectedBatches.length === 2;

  const current = dashboard?.current;
  const delta = dashboard?.delta;
  const trend = dashboard?.trend ?? [];
  const alert = dashboard?.alert ?? null;

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={s.headerRow}>
        <h2 style={s.h2} aria-label={`Eval detail for ${agentName}`}>{agentName}</h2>
        <select
          style={s.timeRangeSelect}
          value={range}
          onChange={(e) => setRange(e.target.value as TimeRangeFilter)}
          aria-label="Time range filter"
        >
          {TIME_RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <Button
          kind="secondary"
          size="sm"
          icon="Play"
          loading={startBatch.isPending || batchInProgress}
          disabled={batchInProgress || startBatch.isPending}
          onClick={() => startBatch.mutate(undefined)}
          aria-label={batchInProgress ? "Eval batch running" : "Run eval batch"}
        >
          {batchInProgress ? "Running…" : "Run eval"}
        </Button>
      </div>

      {/* Alert banner */}
      {alert && (
        <div style={s.alert} role="alert" aria-live="polite">
          <Icon.AlertTriangle size={15} aria-hidden="true" />
          {alert}
        </div>
      )}

      {/* Metric cards */}
      {isLoading ? (
        <Skeleton height={80} />
      ) : (
        <div style={s.metricsRow}>
          <MetricCard
            label="Recall"
            value={formatPercent(current?.recall)}
            delta={delta?.recall}
            trend={trend.map((p) => p.recall)}
            color="var(--accent)"
          />
          <MetricCard
            label="Precision"
            value={formatPercent(current?.precision)}
            delta={delta?.precision}
            trend={trend.map((p) => p.precision)}
            color="var(--warn)"
          />
          <MetricCard
            label="Citation Accuracy"
            value={formatPercent(current?.citation_accuracy)}
            delta={delta?.citation_accuracy}
            trend={trend.map((p) => p.citation_accuracy)}
            color="var(--ok)"
          />
        </div>
      )}

      {/* Trend chart */}
      <div>
        <div style={s.sectionLabel}>Metric Trend</div>
        <MetricTrendChart points={trend} />
      </div>

      {/* Recent Runs table */}
      <div>
        <div style={s.sectionLabel}>Recent Runs</div>
        {!batches || batches.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No batch runs yet.</p>
        ) : (
          <>
            <table style={s.table} aria-label="Recent eval batch runs">
              <thead>
                <tr>
                  <th style={s.checkTd}>
                    <span className="sr-only">Select</span>
                  </th>
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
                {batches.map((batch) => {
                  const passRate =
                    batch.traces_total && batch.traces_total > 0 && batch.traces_passed != null
                      ? batch.traces_passed / batch.traces_total
                      : null;
                  const passed = passRate != null ? passRate >= 0.5 : null;
                  const checked = selectedBatches.includes(batch.id);
                  return (
                    <tr key={batch.id}>
                      <td style={s.checkTd}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBatch(batch.id)}
                          aria-label={`Select batch run from ${formatDate(batch.ran_at)}`}
                          disabled={!checked && selectedBatches.length >= 2}
                        />
                      </td>
                      <td style={s.td}>{formatDate(batch.ran_at)}</td>
                      <td style={s.td}>v{batch.agent_version}</td>
                      <td style={s.td}><MetricBarCell value={batch.recall} /></td>
                      <td style={s.td}><MetricBarCell value={batch.precision} /></td>
                      <td style={s.td}><MetricBarCell value={batch.citation_accuracy} /></td>
                      <td style={s.td}>
                        {/* Pass/fail: icon + text, not color alone */}
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
                      <td style={s.td}>
                        {batch.cost_usd != null ? `$${batch.cost_usd.toFixed(4)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={s.compareBtn}>
              <Button
                kind="secondary"
                size="sm"
                icon="BarChart"
                disabled={!canCompare}
                onClick={() => setCompareOpen(true)}
                aria-label={canCompare ? "Compare selected runs" : "Select exactly 2 runs to compare"}
              >
                Compare{canCompare ? "" : " (select 2)"}
              </Button>
            </div>
          </>
        )}
      </div>

      {compareOpen && canCompare && (
        <CompareModal
          batchIdA={selectedBatches[0]!}
          batchIdB={selectedBatches[1]!}
          agentId={agentId}
          onClose={() => {
            setCompareOpen(false);
            setSelectedBatches([]);
          }}
        />
      )}
    </div>
  );
}
