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

  caseRow: (pass: boolean | null): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    marginBottom: 6,
    opacity: pass === null ? 0.7 : 1,
  }),

  caseName: {
    flex: 1,
    fontSize: 13,
    fontWeight: 500,
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
