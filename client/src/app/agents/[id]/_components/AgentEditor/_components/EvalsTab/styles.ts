import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  } satisfies CSSProperties,

  metricsRow: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  metricCard: {
    flex: "1 1 140px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: "14px 16px",
  } satisfies CSSProperties,

  metricLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    marginBottom: 4,
  } satisfies CSSProperties,

  metricValue: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,

  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  h2: {
    fontSize: 16,
    fontWeight: 700,
    flex: 1,
  } satisfies CSSProperties,

  caseRow: (pass: boolean | null, logExpanded = false): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: logExpanded ? "7px 7px 0 0" : 7,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderLeft:
      pass === true
        ? "3px solid var(--ok)"
        : pass === false
          ? "3px solid var(--crit)"
          : "3px solid var(--border)",
    opacity: pass === null ? 0.7 : 1,
  }),

  runLogPanel: {
    margin: "0 0 0 0",
    padding: "12px 14px",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderTop: "none",
    borderRadius: "0 0 7px 7px",
    fontSize: 12,
  } satisfies CSSProperties,

  runLogHeader: {
    display: "flex",
    gap: 16,
    marginBottom: 8,
    color: "var(--text-muted)",
    fontSize: 11,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  runLogFindings: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } satisfies CSSProperties,

  runLogFinding: {
    padding: "6px 10px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 5,
    fontSize: 12,
    lineHeight: 1.4,
  } satisfies CSSProperties,

  runLogError: {
    padding: "8px 10px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--crit)",
    borderRadius: 5,
    fontSize: 12,
    color: "var(--crit)",
    whiteSpace: "pre-wrap" as const,
  } satisfies CSSProperties,

  caseNameCol: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  } satisfies CSSProperties,

  caseName: {
    fontSize: 13,
    fontWeight: 500,
  } satisfies CSSProperties,

  caseExpectedActual: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  passingCount: {
    fontSize: 13,
    fontWeight: 400,
    color: "var(--text-muted)",
    marginLeft: 6,
  } satisfies CSSProperties,

  passIndicator: (pass: boolean | null): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    color:
      pass === true
        ? "var(--ok)"
        : pass === false
          ? "var(--crit)"
          : "var(--text-muted)",
  }),

  badge: {
    fontSize: 11,
    padding: "2px 7px",
    borderRadius: 5,
    background: "var(--bg-hover)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  dashboardLink: {
    fontSize: 12,
    color: "var(--accent)",
    textDecoration: "underline",
    cursor: "pointer",
  } satisfies CSSProperties,

  emptyNote: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "16px 0",
    textAlign: "center" as const,
  } satisfies CSSProperties,

  batchProgress: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    border: "1px solid var(--accent)",
    fontSize: 13,
  } satisfies CSSProperties,

  batchProgressText: {
    flex: 1,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  batchProgressCount: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
} as const;
