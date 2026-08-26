/* CiRunsTable — table rendering CI run rows (AC-E7). */
"use client";

import React from "react";
import type { CiRun } from "@devdigest/shared";
import { COLUMN_KEYS, COLUMN_LABELS, SKELETON_ROWS } from "../../constants";

export interface CiRunsTableProps {
  runs: CiRun[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

function StatusBadge({ status }: { status: string | null }) {
  const color =
    status === "succeeded"
      ? "var(--ok, #22c55e)"
      : status === "failed"
        ? "var(--error, #ef4444)"
        : status === "running"
          ? "var(--accent)"
          : "var(--text-muted)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 10px",
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 600,
        color: "#fff",
        background: color,
      }}
    >
      {status ?? "—"}
    </span>
  );
}

export function CiRunsTable({ runs, isLoading, error }: CiRunsTableProps) {
  if (error) {
    return (
      <div
        style={{
          padding: "32px",
          textAlign: "center",
          color: "var(--text-secondary)",
          fontSize: 14,
        }}
      >
        Failed to load CI runs: {error.message}
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            {COLUMN_KEYS.map((key) => (
              <th
                key={key}
                style={{
                  textAlign: "left",
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {COLUMN_LABELS[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={i}>
                  {COLUMN_KEYS.map((k) => (
                    <td
                      key={k}
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div
                        style={{
                          height: 14,
                          width: "70%",
                          borderRadius: 4,
                          background: "var(--bg-elevated)",
                          animation: "pulse 1.4s ease-in-out infinite",
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : runs && runs.length > 0
              ? runs.map((run) => (
                  <tr
                    key={run.id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {/* repository */}
                    <td style={cellStyle}>
                      {run.ci_installation_id ? (
                        <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                          {run.ci_installation_id}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {/* pr */}
                    <td style={cellStyle}>
                      {run.pr_number != null ? `#${run.pr_number}` : "—"}
                    </td>
                    {/* agent */}
                    <td style={cellStyle}>{run.agent ?? "—"}</td>
                    {/* source */}
                    <td style={cellStyle}>{run.source ?? "—"}</td>
                    {/* duration */}
                    <td style={cellStyle}>
                      {run.duration_s != null ? `${run.duration_s.toFixed(1)}s` : "—"}
                    </td>
                    {/* findings */}
                    <td style={cellStyle}>
                      {run.findings_count != null ? run.findings_count : "—"}
                    </td>
                    {/* cost */}
                    <td style={cellStyle}>
                      {run.cost_usd != null ? `$${run.cost_usd.toFixed(4)}` : "—"}
                    </td>
                    {/* status */}
                    <td style={cellStyle}>
                      <StatusBadge status={run.status} />
                    </td>
                    {/* link */}
                    <td style={cellStyle}>
                      {run.github_url ? (
                        <a
                          href={run.github_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--accent)", fontSize: 12 }}
                        >
                          View
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              : !isLoading && (
                  <tr>
                    <td
                      colSpan={COLUMN_KEYS.length}
                      style={{
                        padding: "40px 12px",
                        textAlign: "center",
                        color: "var(--text-muted)",
                        fontSize: 13,
                      }}
                    >
                      No CI runs found. Export an agent to CI to get started.
                    </td>
                  </tr>
                )}
        </tbody>
      </table>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "var(--text-primary)",
  verticalAlign: "middle",
};
