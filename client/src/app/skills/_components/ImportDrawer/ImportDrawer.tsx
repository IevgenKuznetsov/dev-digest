"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Markdown } from "@devdigest/ui";
import { useConfirmSkillImport } from "../../../../lib/hooks/skills";
import { notify } from "../../../../lib/toast";
import { s } from "./styles";

export function ImportDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const confirm = useConfirmSkillImport();
  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [showPreview, setShowPreview] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const canSubmit = body.trim().length > 0 && !confirm.isPending;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setBody(text);
      setName(deriveNameFromBody(text));
      setShowPreview(true);
      setError(null);
    };
    reader.readAsText(file);
    // reset so re-selecting same file still triggers onChange
    e.target.value = "";
  };

  const handleImport = async () => {
    setError(null);
    const derivedName = name.trim() || deriveNameFromBody(body);
    try {
      await confirm.mutateAsync({
        name: derivedName,
        description: "",
        type: "custom",
        source: "imported_url",
        body: body.trim(),
      });
      notify.success(t("file.success", { name: derivedName }));
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("drawer.importFailed");
      setError(msg);
    }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.drawer} onClick={(e) => e.stopPropagation()}>
        <div style={s.title}>{t("drawer.title")}</div>
        <div style={s.subtitle}>{t("drawer.subtitle")}</div>

        <div style={s.trustBanner}>
          {t("file.bodyHint")}
        </div>

        {error && <div style={s.errorBanner}>{error}</div>}

        {/* File picker */}
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt"
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />
        <div style={{ marginBottom: 16 }}>
          <Button
            kind="ghost"
            size="sm"
            icon="Upload"
            onClick={() => fileRef.current?.click()}
          >
            Choose SKILL.md from disk
          </Button>
        </div>

        <div style={s.formGroup}>
          <label style={s.label}>{t("file.nameLabel")}</label>
          <input
            style={s.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("file.namePlaceholder")}
          />
          <div style={s.hint}>{t("file.nameHint")}</div>
        </div>

        <div style={s.formGroup}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <label style={s.label}>{t("file.bodyLabel")}</label>
            {body.trim() && (
              <button
                onClick={() => setShowPreview(!showPreview)}
                style={previewToggle}
              >
                {showPreview ? "Edit" : "Preview"}
              </button>
            )}
          </div>
          {showPreview && body.trim() ? (
            <div style={previewBox}>
              <Markdown>{body}</Markdown>
            </div>
          ) : (
            <textarea
              style={s.textarea}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("file.bodyPlaceholder")}
            />
          )}
        </div>

        <div style={s.footer}>
          <Button kind="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" size="sm" disabled={!canSubmit} onClick={handleImport}>
            {confirm.isPending ? t("file.importing") : t("file.import")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function deriveNameFromBody(body: string): string {
  const match = body.match(/^#\s+(.+)/m);
  return match ? match[1]!.trim() : "Untitled skill";
}

const previewBox: React.CSSProperties = {
  maxHeight: 250,
  overflow: "auto",
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  fontSize: 13,
  lineHeight: 1.6,
};

const previewToggle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--accent)",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
};
