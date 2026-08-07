import type { CSSProperties } from "react";

export const s = {
  group: {
    marginBottom: 16,
  } satisfies CSSProperties,

  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 6,
    background: "var(--bg-hover)",
    cursor: "pointer",
    userSelect: "none",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,

  groupLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    flex: 1,
  } satisfies CSSProperties,

  badges: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,

  chevron: {
    color: "var(--text-muted)",
    transition: "transform 0.15s ease",
  } satisfies CSSProperties,

  collapseToggle: {
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  groupBody: {
    marginTop: 4,
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  } satisfies CSSProperties,
} as const;
