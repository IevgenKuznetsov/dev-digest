import type { CSSProperties } from "react";

export const s = {
  page: {
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 28,
    maxWidth: 1100,
  } satisfies CSSProperties,

  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  } satisfies CSSProperties,

  h1: {
    fontSize: 22,
    fontWeight: 700,
    flex: 1,
  } satisfies CSSProperties,

  sectionLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-muted)",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    marginBottom: 14,
  } satisfies CSSProperties,

  agentGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 14,
  } satisfies CSSProperties,

  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  } satisfies CSSProperties,

  th: {
    textAlign: "left" as const,
    padding: "8px 12px",
    color: "var(--text-muted)",
    fontWeight: 600,
    fontSize: 12,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  td: {
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle" as const,
  } satisfies CSSProperties,

  passCell: (pass: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    fontWeight: 600,
    color: pass ? "var(--ok)" : "var(--crit)",
  }),

  bar: (value: number | null): CSSProperties => ({
    display: "inline-block",
    width: 60,
    height: 6,
    borderRadius: 99,
    background: "var(--bg-hover)",
    position: "relative",
    verticalAlign: "middle" as const,
    overflow: "hidden",
    marginRight: 6,
  }),

  emptyNote: {
    fontSize: 14,
    color: "var(--text-muted)",
    textAlign: "center" as const,
    padding: "40px 0",
  } satisfies CSSProperties,
} as const;
