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
  card: (active: boolean): CSSProperties => ({
    padding: "12px 14px",
    borderRadius: 8,
    border: active ? "1.5px solid var(--accent)" : "1px solid transparent",
    background: active ? "var(--bg-surface)" : "transparent",
    cursor: "pointer",
    transition: "border-color 0.15s, background 0.15s",
  }),
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  } satisfies CSSProperties,
  dot: (color: string): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),
  name: { fontWeight: 600, fontSize: 13, flex: 1 } satisfies CSSProperties,
  description: {
    fontSize: 12,
    color: "var(--text-secondary)",
    marginBottom: 8,
    marginLeft: 16,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginLeft: 16,
  } satisfies CSSProperties,
  typeBadge: (type: string): CSSProperties => ({
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: 3,
    background: typeColor(type) + "22",
    color: typeColor(type),
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  }),
  sourceBadge: {
    fontSize: 10,
    color: "var(--text-muted)",
    padding: "1px 6px",
    borderRadius: 3,
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
} as const;
