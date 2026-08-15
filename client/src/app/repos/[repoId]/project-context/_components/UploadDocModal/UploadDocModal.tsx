/* UploadDocModal — dialog for uploading a .md file from the user's machine. */
"use client";

import React from "react";
import { Button } from "@devdigest/ui";
import type { CSSProperties } from "react";

interface UploadDocModalProps {
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  loading?: boolean;
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
    width: 420,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  title: {
    fontSize: 16,
    fontWeight: 700,
  } satisfies CSSProperties,
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  select: {
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 14,
  } satisfies CSSProperties,
  fileInput: {
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 14,
    width: "100%",
  } satisfies CSSProperties,
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 4,
  } satisfies CSSProperties,
} as const;

export function UploadDocModal({ onClose, onSubmit, loading }: UploadDocModalProps) {
  const [directory, setDirectory] = React.useState<"specs" | "docs">("specs");
  const [file, setFile] = React.useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("directory", directory);
    onSubmit(fd);
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.title}>Upload context file</div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={s.field}>
            <label style={s.label}>Target directory</label>
            <select
              style={s.select}
              value={directory}
              onChange={(e) => setDirectory(e.target.value as "specs" | "docs")}
            >
              <option value="specs">specs/</option>
              <option value="docs">docs/</option>
            </select>
          </div>
          <div style={s.field}>
            <label style={s.label}>File</label>
            <input
              style={s.fileInput}
              type="file"
              accept=".md"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
            <span style={s.hint}>Only .md files are accepted.</span>
          </div>
          <div style={s.actions}>
            <Button kind="secondary" size="sm" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button kind="primary" size="sm" type="submit" loading={loading} disabled={!file}>
              Upload
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
