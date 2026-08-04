import type { CSSProperties } from "react";

export const s = {
  /* Full-height two-panel layout (matches agent editor) */
  wrap: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,

  /* ---- Left sidebar ---- */
  sidebar: {
    width: 320,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } as CSSProperties,
  sidebarHeader: {
    padding: "16px 16px 12px",
  } satisfies CSSProperties,
  sidebarTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  } satisfies CSSProperties,
  h1: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg)",
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  sidebarList: { flex: 1, overflow: "auto", padding: "0 8px 12px" } satisfies CSSProperties,

  /* ---- Right detail panel ---- */
  detail: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } as CSSProperties,
  detailPlaceholder: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-muted)",
    fontSize: 14,
  } satisfies CSSProperties,

  /* Detail header bar */
  detailHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  detailName: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,

  /* Tab bar */
  tabBar: {
    display: "flex",
    gap: 0,
    padding: "12px 28px 0",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,
  tab: (active: boolean): CSSProperties => ({
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 500,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    cursor: "pointer",
    background: "transparent",
    borderTop: "none",
    borderLeft: "none",
    borderRight: "none",
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    borderBottomColor: active ? "var(--accent)" : "transparent",
  }),

  /* Config tab content */
  configPanel: {
    flex: 1,
    overflow: "auto",
    padding: "20px 28px 28px",
  } satisfies CSSProperties,
  configHeadingRow: {
    display: "flex",
    alignItems: "center",
    marginBottom: 20,
  } satisfies CSSProperties,
  configHeading: { fontSize: 16, fontWeight: 600, flex: 1 } satisfies CSSProperties,
  formGroup: { marginBottom: 16 } satisfies CSSProperties,
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 4,
  } satisfies CSSProperties,
  input: {
    width: "100%",
    fontSize: 13,
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text-primary)",
    outline: "none",
  } satisfies CSSProperties,
  bodyHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  } satisfies CSSProperties,
  bodyLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  bodyFileBadge: {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 4,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
    fontFamily: "monospace",
  } satisfies CSSProperties,
  textarea: {
    width: "100%",
    fontSize: 13,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text-primary)",
    outline: "none",
    minHeight: 300,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    resize: "vertical",
    lineHeight: 1.5,
  } as CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  saveRow: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 16,
  } satisfies CSSProperties,

  /* Type badge (reused from card) */
  typeBadge: (type: string): CSSProperties => {
    const colors: Record<string, string> = {
      rubric: "#22c55e",
      convention: "#3b82f6",
      security: "#f59e0b",
      custom: "#94a3b8",
    };
    const c = colors[type] ?? colors.custom!;
    return {
      fontSize: 11,
      fontWeight: 600,
      padding: "2px 8px",
      borderRadius: 4,
      background: c + "22",
      color: c,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
    };
  },
} as const;
