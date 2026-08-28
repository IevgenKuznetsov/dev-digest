import type { CSSProperties } from "react";

export const s: Record<string, CSSProperties> = {
  root: {
    position: "relative",
    display: "inline-block",
  },
  panel: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    width: 320,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    padding: 14,
    zIndex: 40,
    animation: "ddpop .12s ease",
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  count: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontWeight: 400,
  },
  list: {
    maxHeight: 320,
    overflowY: "auto",
    marginBottom: 12,
  },
  error: {
    fontSize: 12,
    color: "var(--error)",
    padding: "6px 10px",
    borderRadius: 6,
    backgroundColor: "var(--error-subtle)",
    border: "1px solid var(--error-border)",
    marginBottom: 10,
  },
  hint: {
    fontSize: 12,
    color: "var(--text-muted)",
    textAlign: "center",
    marginTop: 8,
  },
};
