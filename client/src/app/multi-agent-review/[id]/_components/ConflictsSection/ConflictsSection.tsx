/* ConflictsSection — "Where Agents Disagree" section on the Results page. */
"use client";

import React from "react";
import type { Conflict } from "@devdigest/shared";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "var(--severity-critical, #ef4444)",
  WARNING: "var(--severity-warning, #f59e0b)",
  SUGGESTION: "var(--severity-suggestion, #3b82f6)",
  ignored: "var(--text-muted)",
};

const s = {
  section: {
    marginTop: 32,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    flexWrap: "wrap" as const,
    gap: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "pointer",
    userSelect: "none" as const,
  },
  conflictList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  },
  conflictCard: {
    borderRadius: 6,
    border: "1px solid var(--border-subtle)",
    backgroundColor: "var(--surface-2)",
    overflow: "hidden",
  },
  conflictHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    backgroundColor: "var(--surface-3)",
    borderBottom: "1px solid var(--border-subtle)",
    flexWrap: "wrap" as const,
    gap2: 8,
  },
  fileLocation: {
    fontSize: 12,
    fontFamily: "monospace",
    color: "var(--text-muted)",
    flexShrink: 0,
  },
  conflictTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
    flex: 1,
    minWidth: 0,
  },
  takesRow: {
    display: "flex",
    gap: 8,
    padding: "10px 14px",
    flexWrap: "wrap" as const,
  },
  take: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    minWidth: 80,
  },
  takeAgent: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  takeVerdict: (verdict: string) => ({
    fontSize: 11,
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: 3,
    display: "inline-block",
    textTransform: "uppercase" as const,
    letterSpacing: "0.03em",
    color: SEVERITY_COLORS[verdict] ?? "var(--text-muted)",
    backgroundColor:
      verdict === "CRITICAL"
        ? "rgba(239,68,68,0.12)"
        : verdict === "WARNING"
          ? "rgba(245,158,11,0.12)"
          : verdict === "SUGGESTION"
            ? "rgba(59,130,246,0.12)"
            : "var(--surface-3)",
  }),
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
  },
};

interface ConflictsSectionProps {
  conflicts: Conflict[];
  /** Whether to hide when conflicts is empty or only 1 agent — caller controls visibility */
}

export function ConflictsSection({ conflicts }: ConflictsSectionProps) {
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);

  // "Show only conflicts" filters out groups where all takes have the same verdict
  const displayed = onlyConflicts
    ? conflicts.filter((c) => {
        const verdicts = new Set(c.takes.map((t) => t.verdict));
        return verdicts.size > 1;
      })
    : conflicts;

  return (
    <section style={s.section} aria-label="Where agents disagree">
      <div style={s.header}>
        <h2 style={s.title}>Where Agents Disagree</h2>
        <label style={s.toggleLabel}>
          <input
            type="checkbox"
            checked={onlyConflicts}
            onChange={(e) => setOnlyConflicts(e.target.checked)}
            aria-label="Show only conflicts where agents disagree"
          />
          Show only conflicts
        </label>
      </div>

      {conflicts.length === 0 ? (
        <p style={s.empty}>No disagreements found — agents produced consistent findings.</p>
      ) : displayed.length === 0 ? (
        <p style={s.empty}>No strict conflicts found with the current filter.</p>
      ) : (
        <div style={s.conflictList}>
          {displayed.map((conflict, i) => (
            <div key={i} style={s.conflictCard}>
              <div style={s.conflictHeader}>
                <span style={s.fileLocation}>
                  {conflict.file}:{conflict.line}
                </span>
                <span style={s.conflictTitle}>{conflict.title}</span>
              </div>
              <div style={s.takesRow}>
                {conflict.takes.map((take) => (
                  <div key={take.agent_id} style={s.take}>
                    <span style={s.takeAgent}>{take.persona}</span>
                    <span style={s.takeVerdict(take.verdict)}>{take.verdict}</span>
                    {take.note && (
                      <span style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                        {take.note}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
