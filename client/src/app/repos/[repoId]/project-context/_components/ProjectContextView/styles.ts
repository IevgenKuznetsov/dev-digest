import type { CSSProperties } from "react";

/** Co-located styles for ProjectContextView. */
export const s = {
  root: {
    display: "flex",
    height: "calc(100vh - 52px)",
    overflow: "hidden",
  } satisfies CSSProperties,

  // ----- Left panel -----
  leftPanel: {
    width: 280,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,

  leftHeader: {
    padding: "14px 14px 10px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,

  leftTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 8,
  } satisfies CSSProperties,

  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  } satisfies CSSProperties,

  toolBtn: {
    padding: "4px 6px",
    border: "none",
    background: "none",
    color: "var(--text-secondary)",
    cursor: "pointer",
    borderRadius: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } satisfies CSSProperties,

  searchInput: {
    margin: "8px 14px",
    padding: "6px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 13,
    width: "calc(100% - 28px)",
  } satisfies CSSProperties,

  fileList: {
    flex: 1,
    overflow: "auto",
    padding: "0 8px 8px",
  } satisfies CSSProperties,

  fileItem: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 8px",
    borderRadius: 6,
    cursor: "pointer",
    marginBottom: 2,
    background: active ? "var(--accent-subtle)" : "transparent",
    color: active ? "var(--accent-text)" : "var(--text-primary)",
    fontWeight: active ? 600 : 400,
  }),

  fileName: {
    fontSize: 13,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  fileCategory: (category: string): CSSProperties => {
    const base: CSSProperties = {
      fontSize: 10,
      padding: "1px 5px",
      borderRadius: 3,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      flexShrink: 0,
      fontWeight: 600,
    };
    if (category === "specs") {
      return { ...base, color: "#22c55e", background: "rgba(34,197,94,0.12)" };
    }
    if (category === "insights") {
      return { ...base, color: "#2dd4bf", background: "rgba(45,212,191,0.12)" };
    }
    if (category === "docs") {
      return { ...base, color: "#60a5fa", background: "rgba(96,165,250,0.12)" };
    }
    // other
    return { ...base, color: "var(--text-muted)", background: "var(--bg-elevated)" };
  },

  footer: {
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 11,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  } satisfies CSSProperties,

  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--ok)",
    flexShrink: 0,
  } satisfies CSSProperties,

  // ----- Right panel -----
  rightPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  } satisfies CSSProperties,

  rightHeader: {
    padding: "14px 20px 12px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  } satisfies CSSProperties,

  rightFilename: {
    fontSize: 14,
    fontWeight: 600,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: "monospace",
  } satisfies CSSProperties,

  dirtyDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--warn)",
    flexShrink: 0,
  } satisfies CSSProperties,

  toggleBtn: (active: boolean): CSSProperties => ({
    padding: "4px 10px",
    border: "1px solid var(--border)",
    borderRadius: 5,
    background: active ? "var(--accent)" : "transparent",
    color: active ? "var(--bg-page)" : "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  }),

  rightBody: {
    flex: 1,
    overflow: "auto",
    padding: 20,
    minHeight: 0,
  } satisfies CSSProperties,

  textarea: {
    width: "100%",
    height: "100%",
    minHeight: 300,
    padding: 14,
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 13,
    fontFamily: "monospace",
    lineHeight: 1.55,
    resize: "vertical",
    boxSizing: "border-box",
  } satisfies CSSProperties,

  saveRow: {
    display: "flex",
    gap: 8,
    marginTop: 12,
    alignItems: "center",
  } satisfies CSSProperties,

  unsavedNote: {
    fontSize: 12,
    color: "var(--warn)",
    flex: 1,
  } satisfies CSSProperties,

  placeholder: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-muted)",
    fontSize: 14,
  } satisfies CSSProperties,
} as const;
