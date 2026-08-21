/* AgentEvalCard — per-agent summary card for the eval dashboard grid. */
"use client";

import React from "react";
import type { EvalAgentSummary } from "@devdigest/shared";
import { s } from "./styles";

function formatPercent(v: number | null | undefined): string {
  if (v == null) return "—";
  return (v * 100).toFixed(1) + "%";
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function AgentEvalCard({
  summary,
  onClick,
}: {
  summary: EvalAgentSummary;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      style={s.card}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`View eval dashboard for ${summary.agent_name}`}
    >
      <div style={s.headerRow}>
        <span style={s.agentName}>{summary.agent_name}</span>
        <span style={s.versionBadge}>v{summary.agent_version}</span>
        {/* Status dot — with aria description */}
        <span
          style={s.statusDot(summary.latest_status ?? null)}
          aria-label={`Status: ${summary.latest_status ?? "no runs"}`}
          title={summary.latest_status ?? "no runs"}
        />
      </div>

      <div style={s.metaRow}>
        <span>Last run: {formatDate(summary.last_ran_at)}</span>
        <span>{summary.cases_total} cases</span>
        {summary.traces_passed != null && summary.traces_total != null && (
          <span>
            {summary.traces_passed}/{summary.traces_total} passed
          </span>
        )}
      </div>

      <div style={s.metricsRow}>
        <span style={s.metricPill} aria-label={`Recall: ${formatPercent(summary.recall)}`}>
          R: {formatPercent(summary.recall)}
        </span>
        <span style={s.metricPill} aria-label={`Precision: ${formatPercent(summary.precision)}`}>
          P: {formatPercent(summary.precision)}
        </span>
        <span style={s.metricPill} aria-label={`Citation accuracy: ${formatPercent(summary.citation_accuracy)}`}>
          C: {formatPercent(summary.citation_accuracy)}
        </span>
      </div>
    </div>
  );
}
