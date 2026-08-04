import type { CSSProperties } from "react";

const TYPE_COLORS: Record<string, string> = {
  rubric: "#22c55e",
  convention: "#3b82f6",
  security: "#f59e0b",
  custom: "#94a3b8",
};

export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? TYPE_COLORS.custom!;
}

export const s = {
  wrap: { padding: "20px 24px" } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 } satisfies CSSProperties,
  title: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  countBadge: {
    fontSize: 12,
    fontWeight: 600,
    padding: "2px 10px",
    borderRadius: 10,
    background: "var(--accent-bg)",
    color: "var(--accent)",
  } satisfies CSSProperties,
  filterWrap: { flex: 1 } satisfies CSSProperties,
  filterInput: {
    fontSize: 13,
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    outline: "none",
    width: 200,
  } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-muted)", marginBottom: 16 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 2 } as CSSProperties,
  row: (linked: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    background: linked ? "var(--bg-surface)" : "transparent",
    border: linked ? "1px solid var(--border)" : "1px solid transparent",
    cursor: "grab",
    transition: "background 0.1s",
  }),
  dragHandle: {
    color: "var(--text-muted)",
    cursor: "grab",
    fontSize: 16,
    userSelect: "none",
    lineHeight: 1,
  } as CSSProperties,
  checkbox: { cursor: "pointer", accentColor: "var(--accent)" } satisfies CSSProperties,
  skillName: { flex: 1, fontSize: 14 } satisfies CSSProperties,
  typeBadge: (type: string): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 4,
    background: typeColor(type) + "22",
    color: typeColor(type),
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  }),
  separator: {
    height: 1,
    background: "var(--border)",
    margin: "8px 0",
  } satisfies CSSProperties,
} as const;
