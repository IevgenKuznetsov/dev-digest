import type { CSSProperties } from "react";

export const s = {
  body: {
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,

  fieldLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 6,
  } satisfies CSSProperties,

  inputTabBar: {
    display: "flex",
    gap: 2,
    marginBottom: 8,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  inputTab: (active: boolean): CSSProperties => ({
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    background: "none",
    border: "none",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    cursor: "pointer",
    marginBottom: -1,
  }),

  monoArea: {
    width: "100%",
    minHeight: 120,
    padding: "10px 12px",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    lineHeight: 1.6,
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    color: "var(--text-primary)",
    resize: "vertical" as const,
    outline: "none",
    boxSizing: "border-box" as const,
  } satisfies CSSProperties,

  jsonStatusRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  } satisfies CSSProperties,

  jsonStatus: (valid: boolean): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color: valid ? "var(--ok)" : "var(--crit)",
  }),

  footer: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  footerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: 1,
  } satisfies CSSProperties,

  runStatusText: {
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  toggleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  fieldRow: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  } satisfies CSSProperties,
} as const;
