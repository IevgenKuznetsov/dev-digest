/* SettingsProjectContext — configure glob patterns used when searching the
   repository for spec files to import into the project context. */
"use client";

import React from "react";
import { Button } from "@devdigest/ui";
import type { CSSProperties } from "react";
import { useSettings, useUpdateSettings } from "@/lib/hooks/core";

export const DEFAULT_SCAN_PATTERNS = "**/*.md";

const s = {
  wrap: { maxWidth: 640 } satisfies CSSProperties,
  heading: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 4,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginBottom: 20,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  field: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  input: {
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 14,
    fontFamily: "monospace",
  } satisfies CSSProperties,
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, marginTop: 16 } satisfies CSSProperties,
} as const;

export function SettingsProjectContext() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();

  const saved = (settings as Record<string, unknown> | undefined)?.["context_scan_patterns"] as
    | string
    | undefined;
  const [patterns, setPatterns] = React.useState(saved ?? DEFAULT_SCAN_PATTERNS);

  // Sync once the settings load
  React.useEffect(() => {
    if (saved !== undefined) setPatterns(saved);
  }, [saved]);

  const isDirty = patterns !== (saved ?? DEFAULT_SCAN_PATTERNS);

  const handleSave = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update.mutate({ context_scan_patterns: patterns } as any);
  };

  const handleReset = () => {
    setPatterns(DEFAULT_SCAN_PATTERNS);
  };

  return (
    <div style={s.wrap}>
      <div style={s.heading}>Project Context</div>
      <div style={s.subtitle}>
        Configure which files are offered when searching the repository for spec files
        to import into the project context.
      </div>
      <div style={s.field}>
        <label style={s.label}>Spec file patterns</label>
        <input
          style={s.input}
          value={patterns}
          onChange={(e) => setPatterns(e.target.value)}
          placeholder={DEFAULT_SCAN_PATTERNS}
          aria-label="Spec file patterns"
        />
        <span style={s.hint}>
          Comma-separated glob patterns. Patterns containing a &ldquo;/&rdquo; are used
          verbatim (e.g.&nbsp;<code>**/*.md</code>). Patterns without a &ldquo;/&rdquo;
          are matched anywhere in the tree (e.g.&nbsp;<code>*spec.md</code> →&nbsp;
          <code>**/*spec.md</code>).
        </span>
      </div>
      <div style={s.actions}>
        <Button
          kind="primary"
          size="sm"
          onClick={handleSave}
          loading={update.isPending}
          disabled={!isDirty}
        >
          Save
        </Button>
        <Button kind="secondary" size="sm" onClick={handleReset} disabled={!isDirty}>
          Reset to default
        </Button>
      </div>
    </div>
  );
}
