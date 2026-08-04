import type { CSSProperties } from "react";

export const s = {
  card: {
    display: "flex",
    gap: 16,
    padding: "20px 24px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg)",
  } as CSSProperties,
  body: {
    flex: 1,
    minWidth: 0,
  } as CSSProperties,
  rule: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.4,
    marginBottom: 8,
  } as CSSProperties,
  evidenceLink: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--accent)",
    textDecoration: "none",
    marginBottom: 8,
    display: "inline-block",
    cursor: "pointer",
  } as CSSProperties,
  snippet: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    background: "var(--bg-surface)",
    borderRadius: 6,
    padding: "10px 14px",
    marginBottom: 10,
    whiteSpace: "pre-wrap",
    overflowX: "auto",
  } as CSSProperties,
  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } as CSSProperties,
  confidenceLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-muted)",
  } as CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "flex-end",
    flexShrink: 0,
  } as CSSProperties,
} as const;
