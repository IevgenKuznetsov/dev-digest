/* EmptyState — shown when no context documents have been scanned yet. */
"use client";

import React from "react";
import { Button } from "@devdigest/ui";
import type { CSSProperties } from "react";

interface EmptyStateProps {
  onUpload: () => void;
  onScanRepo: () => void;
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
  popoverWrap: { position: "relative" } satisfies CSSProperties,
  popover: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: "50%",
    transform: "translateX(-50%)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 4,
    minWidth: 180,
    zIndex: 100,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
  } satisfies CSSProperties,
  popoverItem: {
    display: "block",
    width: "100%",
    padding: "8px 12px",
    borderRadius: 4,
    border: "none",
    background: "none",
    color: "var(--text-primary)",
    fontSize: 13,
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;

export function EmptyState({ onUpload, onScanRepo }: EmptyStateProps) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div style={s.wrap}>
      <span style={{ fontSize: 40 }}>📄</span>
      <div style={s.title}>No spec files yet</div>
      <div style={s.body}>
        Add context documents (specs, docs, INSIGHTS.md) so agents can ground
        their reviews in project-specific requirements.
      </div>
      <div ref={wrapRef} style={s.popoverWrap}>
        <Button kind="primary" icon="Plus" onClick={() => setOpen((v) => !v)}>
          Add a spec file
        </Button>
        {open && (
          <div style={s.popover}>
            <button
              style={s.popoverItem}
              type="button"
              onClick={() => { setOpen(false); onUpload(); }}
            >
              Upload from disk
            </button>
            <button
              style={s.popoverItem}
              type="button"
              onClick={() => { setOpen(false); onScanRepo(); }}
            >
              Search repository
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
