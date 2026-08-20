import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
  } satisfies CSSProperties,

  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  h2: {
    fontSize: 18,
    fontWeight: 700,
    flex: 1,
  } satisfies CSSProperties,

  timeRangeSelect: {
    fontSize: 13,
    padding: "5px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    cursor: "pointer",
  } satisfies CSSProperties,

  alert: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    background: "rgba(220,50,50,0.08)",
    border: "1px solid var(--crit)",
    fontSize: 13,
    color: "var(--crit)",
  } satisfies CSSProperties,

  metricsRow: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  sectionLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-muted)",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    marginBottom: 12,
  } satisfies CSSProperties,

  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  } satisfies CSSProperties,

  th: {
    textAlign: "left" as const,
    padding: "8px 10px",
    color: "var(--text-muted)",
    fontWeight: 600,
    fontSize: 12,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  td: {
    padding: "9px 10px",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle" as const,
  } satisfies CSSProperties,

  checkTd: {
    width: 36,
    padding: "9px 10px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  compareBtn: {
    marginTop: 12,
  } satisfies CSSProperties,

  passCell: (pass: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    color: pass ? "var(--ok)" : "var(--crit)",
  }),
} as const;
