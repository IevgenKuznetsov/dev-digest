import type { CSSProperties } from "react";

export const s = {
  body: {
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  } satisfies CSSProperties,

  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-secondary)",
    marginBottom: 10,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  } satisfies CSSProperties,

  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 10,
  } satisfies CSSProperties,

  metricDelta: {
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "12px 14px",
  } satisfies CSSProperties,

  metricDeltaLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.05em",
    marginBottom: 6,
  } satisfies CSSProperties,

  metricDeltaRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
  } satisfies CSSProperties,

  deltaValue: (positive: boolean | null): CSSProperties => ({
    fontSize: 13,
    fontWeight: 700,
    color:
      positive === true
        ? "var(--ok)"
        : positive === false
          ? "var(--crit)"
          : "var(--text-muted)",
  }),

  diffContainer: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    lineHeight: 1.6,
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "12px 14px",
    maxHeight: 200,
    overflow: "auto",
    whiteSpace: "pre-wrap" as const,
  } satisfies CSSProperties,

  diffAdd: {
    background: "rgba(0,200,100,0.1)",
    display: "block",
  } satisfies CSSProperties,

  diffRemove: {
    background: "rgba(220,50,50,0.1)",
    display: "block",
  } satisfies CSSProperties,

  diffContext: {
    color: "var(--text-muted)",
    display: "block",
  } satisfies CSSProperties,

  flipRow: (regression: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  }),

  flipIcon: (regression: boolean): CSSProperties => ({
    color: regression ? "var(--crit)" : "var(--ok)",
    display: "flex",
    alignItems: "center",
  }),

  collapseTrigger: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    background: "none",
    border: "none",
    color: "var(--text-primary)",
    padding: 0,
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  } satisfies CSSProperties,
} as const;
