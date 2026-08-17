/* CreateFolderModal — dialog for creating a new folder inside a context directory. */
"use client";

import React from "react";
import { Button } from "@devdigest/ui";
import type { CSSProperties } from "react";

interface CreateFolderModalProps {
  onClose: () => void;
  onSubmit: (directory: "specs" | "docs" | "insights", name: string) => void;
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
  input: {
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 14,
    fontFamily: "monospace",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 4,
  } satisfies CSSProperties,
} as const;

export function CreateFolderModal({ onClose, onSubmit, loading }: CreateFolderModalProps) {
  const [directory, setDirectory] = React.useState<"specs" | "docs" | "insights">("specs");
  const [name, setName] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(directory, name);
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.title}>Create new folder</div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={s.field}>
            <label style={s.label}>Parent directory</label>
            <select
              style={s.select}
              value={directory}
              onChange={(e) => setDirectory(e.target.value as "specs" | "docs" | "insights")}
            >
              <option value="specs">specs/</option>
              <option value="docs">docs/</option>
              <option value="insights">insights/</option>
            </select>
          </div>
          <div style={s.field}>
            <label style={s.label}>Folder name</label>
            <input
              style={s.input}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-folder"
              autoFocus
              required
            />
          </div>
          <div style={s.actions}>
            <Button kind="secondary" size="sm" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button kind="primary" size="sm" type="submit" loading={loading} disabled={!name.trim()}>
              Create
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
