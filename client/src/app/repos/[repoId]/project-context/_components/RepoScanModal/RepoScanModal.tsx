/* RepoScanModal — scan the repository for .md files matching a glob pattern
   and let the user pick which ones to import into the project context. */
"use client";

import React from "react";
import { Button } from "@devdigest/ui";
import type { CSSProperties } from "react";
import { useContextFind, useContextImport } from "@/lib/hooks/project-context";
import { useSettings } from "@/lib/hooks/core";
import { DEFAULT_SCAN_PATTERNS } from "../../../../../settings/[section]/_components/SettingsView/_components/SettingsProjectContext";

interface RepoScanModalProps {
  repoId: string;
  onClose: () => void;
  onImported: () => void;
}

const s = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  } satisfies CSSProperties,
  modal: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 24,
    width: 520,
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  patternRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  } satisfies CSSProperties,
  patternInput: {
    flex: 1,
    padding: "7px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 13,
    fontFamily: "monospace",
  } satisfies CSSProperties,
  patternHint: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: -6,
  } satisfies CSSProperties,
  list: {
    overflowY: "auto",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxHeight: 300,
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 4px",
  } satisfies CSSProperties,
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 10px",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 13,
    color: "var(--text-primary)",
    userSelect: "none",
  } satisfies CSSProperties,
  itemHover: { background: "var(--bg-hover)" } satisfies CSSProperties,
  checkbox: { flexShrink: 0, accentColor: "var(--accent)" } satisfies CSSProperties,
  path: { fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" } satisfies CSSProperties,
  empty: {
    padding: 32,
    textAlign: "center",
    color: "var(--text-muted)",
    fontSize: 13,
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    justifyContent: "space-between",
    alignItems: "center",
  } satisfies CSSProperties,
  selectAll: {
    fontSize: 12,
    color: "var(--text-muted)",
    cursor: "pointer",
    textDecoration: "underline",
    background: "none",
    border: "none",
    padding: 0,
  } satisfies CSSProperties,
  actionBtns: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;

export function RepoScanModal({ repoId, onClose, onImported }: RepoScanModalProps) {
  const { data: settings } = useSettings();
  const savedPatterns = (
    (settings as Record<string, unknown> | undefined)?.["context_scan_patterns"] as
      | string
      | undefined
  ) ?? DEFAULT_SCAN_PATTERNS;

  // Local pattern the user can edit for this search only
  const [inputPattern, setInputPattern] = React.useState(savedPatterns);
  // The pattern actually sent to the server (set on Search)
  const [searchPattern, setSearchPattern] = React.useState(savedPatterns);
  const [searchKey, setSearchKey] = React.useState(0); // increment to force re-fetch
  const [triggered, setTriggered] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [hoveredPath, setHoveredPath] = React.useState<string | null>(null);

  const { data, isLoading, isError } = useContextFind(
    repoId,
    searchPattern,
    triggered,
    searchKey,
  );
  const importMutation = useContextImport(repoId);

  // Auto-search on mount
  React.useEffect(() => {
    setTriggered(true);
  }, []);

  // Reset selection when results change
  React.useEffect(() => {
    setSelected(new Set());
  }, [data]);

  const paths = data?.paths ?? [];

  const handleSearch = () => {
    setSearchPattern(inputPattern);
    setSearchKey((k) => k + 1);
    setTriggered(true);
  };

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleImport = () => {
    importMutation.mutate(Array.from(selected), {
      onSuccess: () => {
        onImported();
        onClose();
      },
    });
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.title}>Search repository for spec files</div>

        {/* Pattern input */}
        <div>
          <div style={s.patternRow}>
            <input
              style={s.patternInput}
              value={inputPattern}
              onChange={(e) => setInputPattern(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={DEFAULT_SCAN_PATTERNS}
              aria-label="Glob pattern"
            />
            <Button kind="secondary" size="sm" onClick={handleSearch} loading={isLoading}>
              Search
            </Button>
          </div>
          <div style={s.patternHint}>
            Glob pattern &mdash; default saved in{" "}
            <a href="/settings/project-context" style={{ color: "var(--accent)" }}>
              Settings › Project Context
            </a>
          </div>
        </div>

        {/* Results */}
        {isLoading && <div style={s.empty}>Scanning repository&hellip;</div>}

        {isError && (
          <div style={{ ...s.empty, color: "var(--text-danger)" }}>
            Scan failed. Make sure the repository is cloned.
          </div>
        )}

        {!isLoading && !isError && triggered && paths.length === 0 && (
          <div style={s.empty}>No files matched the pattern.</div>
        )}

        {!isLoading && !isError && paths.length > 0 && (
          <div style={s.list}>
            {paths.map((p) => (
              <div
                key={p}
                style={{ ...s.item, ...(hoveredPath === p ? s.itemHover : {}) }}
                onClick={() => toggle(p)}
                onMouseEnter={() => setHoveredPath(p)}
                onMouseLeave={() => setHoveredPath(null)}
              >
                <input
                  type="checkbox"
                  style={s.checkbox}
                  checked={selected.has(p)}
                  onChange={() => toggle(p)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span style={s.path}>{p}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={s.actions}>
          <div>
            {paths.length > 0 && (
              <>
                <button style={s.selectAll} onClick={() => setSelected(new Set(paths))} type="button">
                  Select all
                </button>
                &nbsp;/&nbsp;
                <button style={s.selectAll} onClick={() => setSelected(new Set())} type="button">
                  None
                </button>
              </>
            )}
          </div>
          <div style={s.actionBtns}>
            <Button kind="secondary" size="sm" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button
              kind="primary"
              size="sm"
              onClick={handleImport}
              loading={importMutation.isPending}
              disabled={selected.size === 0}
            >
              Import{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
