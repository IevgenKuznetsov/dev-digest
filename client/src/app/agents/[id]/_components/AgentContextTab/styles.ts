import type { CSSProperties } from "react";

export const MAX_ATTACHED_DOCS = 10;

export const s = {
  wrap: { padding: "20px 24px" } satisfies CSSProperties,

  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  } satisfies CSSProperties,

  title: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,

  countBadge: {
    fontSize: 12,
    fontWeight: 600,
    padding: "2px 10px",
    borderRadius: 10,
    background: "var(--accent-bg)",
    color: "var(--accent)",
  } satisfies CSSProperties,

  hint: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginBottom: 16,
    lineHeight: 1.5,
  } satisfies CSSProperties,

  list: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,

  row: (attached: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    background: attached ? "var(--bg-surface)" : "transparent",
    border: attached ? "1px solid var(--border)" : "1px solid transparent",
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

  docName: {
    fontSize: 14,
    fontWeight: 500,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  docPath: {
    fontSize: 11,
    color: "var(--text-muted)",
    fontFamily: "monospace",
    maxWidth: 160,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  categoryBadge: (category: string): CSSProperties => {
    const colors: Record<string, string> = {
      specs: "#3b82f6",
      docs: "#22c55e",
      insights: "#f59e0b",
      other: "#94a3b8",
    };
    const c = colors[category] ?? colors.other!;
    return {
      fontSize: 10,
      fontWeight: 700,
      padding: "2px 6px",
      borderRadius: 4,
      background: c + "22",
      color: c,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      flexShrink: 0,
    };
  },

  checkbox: { cursor: "pointer", accentColor: "var(--accent)" } satisfies CSSProperties,

  separator: {
    height: 1,
    background: "var(--border)",
    margin: "8px 0",
  } satisfies CSSProperties,

  footer: {
    marginTop: 16,
    padding: "12px 16px",
    borderRadius: 8,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    fontSize: 13,
    color: "var(--text-secondary)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,

  tokenCount: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
} as const;
