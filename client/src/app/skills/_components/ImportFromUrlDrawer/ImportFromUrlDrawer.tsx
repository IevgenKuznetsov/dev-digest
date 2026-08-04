"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { useImportFromUrl } from "../../../../lib/hooks/skills";
import { notify } from "../../../../lib/toast";
import { s } from "../ImportDrawer/styles";

export function ImportFromUrlDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const importUrl = useImportFromUrl();
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");

  const canSubmit = url.trim().length > 0 && !importUrl.isPending;

  const handleImport = async () => {
    const skill = await importUrl.mutateAsync({
      url: url.trim(),
      name: name.trim() || undefined,
    });
    notify.success(t("url.success", { name: skill.name }));
    onClose();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.drawer} onClick={(e) => e.stopPropagation()}>
        <div style={s.title}>{t("drawer.title")}</div>
        <div style={s.subtitle}>{t("url.hint")}</div>

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

        <div style={s.footer}>
          <Button kind="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" size="sm" disabled={!canSubmit} onClick={handleImport}>
            {importUrl.isPending ? t("url.fetching") : t("url.import")}
          </Button>
        </div>
      </div>
    </div>
  );
}
