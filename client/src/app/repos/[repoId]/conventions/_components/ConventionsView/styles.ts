import type { CSSProperties } from "react";

export const s = {
  root: {
    height: "calc(100vh - 52px)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  } as CSSProperties,
  header: {
    padding: "24px 28px 0",
  } as CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 4,
  } as CSSProperties,
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
    letterSpacing: "-0.02em",
  } as CSSProperties,
  repoAccent: {
    color: "var(--accent)",
  } as CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginBottom: 16,
  } as CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 28px",
    borderBottom: "1px solid var(--border)",
  } as CSSProperties,
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } as CSSProperties,
  deselectBtn: {
    fontSize: 13,
    color: "var(--text-muted)",
    cursor: "pointer",
    background: "none",
    border: "none",
    padding: 0,
    display: "flex",
    alignItems: "center",
    gap: 4,
  } as CSSProperties,
  acceptedCount: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } as CSSProperties,
  list: {
    flex: 1,
    overflowY: "auto",
  } as CSSProperties,
} as const;
