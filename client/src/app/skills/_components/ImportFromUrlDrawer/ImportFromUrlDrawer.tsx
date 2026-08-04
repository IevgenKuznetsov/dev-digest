"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton, Markdown } from "@devdigest/ui";
import { usePreviewFromUrl, useConfirmSkillImport, type ImportPreview } from "../../../../lib/hooks/skills";
import { notify } from "../../../../lib/toast";
import { s } from "../ImportDrawer/styles";

export function ImportFromUrlDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const previewMut = usePreviewFromUrl();
  const confirm = useConfirmSkillImport();
  const [url, setUrl] = React.useState("");
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-fetch preview when URL changes (debounced)
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreview(null);
    setError(null);

    const trimmed = url.trim();
    if (!trimmed) return;

    // Basic URL check before fetching
    try { new URL(trimmed); } catch { return; }

    debounceRef.current = setTimeout(async () => {
      try {
        const result = await previewMut.mutateAsync({ url: trimmed });
        setPreview(result);
        setName(result.name);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : t("drawer.importFailed");
        setError(msg);
      }
    }, 600);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const canSubmit = !!preview && !confirm.isPending;

  const handleImport = async () => {
    if (!preview) return;
    setError(null);
    try {
      await confirm.mutateAsync({
        name: name.trim() || preview.name,
        description: preview.description,
        type: preview.type,
        source: "imported_url",
        body: preview.body,
      });
      notify.success(t("url.success", { name: name.trim() || preview.name }));
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
        <div style={s.subtitle}>{t("url.hint")}</div>

        {error && <div style={s.errorBanner}>{error}</div>}

        <div style={s.formGroup}>
          <label style={s.label}>{t("url.label")}</label>
          <input
            style={s.input}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("url.placeholder")}
            autoFocus
          />
        </div>

        {previewMut.isPending && (
          <div style={s.formGroup}>
            <Skeleton height={24} />
            <div style={{ marginTop: 8 }}><Skeleton height={120} /></div>
          </div>
        )}

        {preview && (
          <>
            <div style={s.formGroup}>
              <label style={s.label}>{t("file.nameLabel")}</label>
              <input
                style={s.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("file.namePlaceholder")}
              />
            </div>

            <div style={s.formGroup}>
              <label style={s.label}>Preview</label>
              <div style={previewBox}>
                <Markdown>{preview.body}</Markdown>
              </div>
            </div>
          </>
        )}

        <div style={s.footer}>
          <Button kind="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" size="sm" disabled={!canSubmit} onClick={handleImport}>
            {confirm.isPending ? t("file.importing") : t("url.import")}
          </Button>
        </div>
      </div>
    </div>
  );
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
