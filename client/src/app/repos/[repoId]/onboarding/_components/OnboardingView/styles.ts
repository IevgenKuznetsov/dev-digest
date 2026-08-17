import type { CSSProperties } from "react";

export const s = {
  root: {
    maxWidth: 800,
    margin: "0 auto",
    padding: "32px 28px 64px",
    display: "flex",
    flexDirection: "column",
    gap: 32,
  } as CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  } as CSSProperties,
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
    letterSpacing: "-0.02em",
    margin: 0,
  } as CSSProperties,
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } as CSSProperties,
  generatingRoot: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 320,
    gap: 16,
    color: "var(--text-muted)",
  } as CSSProperties,
  generatingText: {
    fontSize: 15,
    color: "var(--text-secondary)",
  } as CSSProperties,
  generatingPhase: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginTop: -8,
  } as CSSProperties,
  sections: {
    display: "flex",
    flexDirection: "column",
    gap: 40,
  } as CSSProperties,
} as const;
