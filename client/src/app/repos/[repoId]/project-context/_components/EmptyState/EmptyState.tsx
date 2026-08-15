/* EmptyState — shown when no context documents have been scanned yet. */
"use client";

import React from "react";
import { Button } from "@devdigest/ui";
import type { CSSProperties } from "react";

interface EmptyStateProps {
  onAdd: () => void;
}

const s = {
  wrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 48,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  body: {
    fontSize: 14,
    color: "var(--text-secondary)",
    textAlign: "center",
    maxWidth: 380,
    lineHeight: 1.6,
  } satisfies CSSProperties,
} as const;

export function EmptyState({ onAdd }: EmptyStateProps) {
  return (
    <div style={s.wrap}>
      <span style={{ fontSize: 40 }}>📄</span>
      <div style={s.title}>No spec files yet</div>
      <div style={s.body}>
        Add context documents (specs, docs, INSIGHTS.md) so agents can ground
        their reviews in project-specific requirements.
      </div>
      <Button kind="primary" icon="Plus" onClick={onAdd}>
        + Add a spec file
      </Button>
    </div>
  );
}
