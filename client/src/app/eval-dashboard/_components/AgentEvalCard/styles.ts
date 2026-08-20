import type { CSSProperties } from "react";

export const s = {
  card: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 18,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    transition: "border-color .15s ease",
  } satisfies CSSProperties,

  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  } satisfies CSSProperties,

  agentName: {
    flex: 1,
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text-primary)",
    wordBreak: "break-word" as const,
  } satisfies CSSProperties,

  versionBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 7px",
    borderRadius: 5,
    background: "var(--bg-hover)",
    color: "var(--text-secondary)",
    flexShrink: 0,
  } satisfies CSSProperties,

  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  metricsRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  metricPill: {
    fontSize: 12,
    fontWeight: 600,
    padding: "3px 9px",
    borderRadius: 99,
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,

  statusDot: (status: string | null): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    background:
      status === "done"
        ? "var(--ok)"
        : status === "failed"
          ? "var(--crit)"
          : status === "running" || status === "queued"
            ? "var(--warn)"
            : "var(--text-muted)",
    flexShrink: 0,
  }),
} as const;
