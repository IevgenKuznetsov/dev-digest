"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { useConfirmSkillImport } from "../../../../lib/hooks/skills";
import { notify } from "../../../../lib/toast";
import { s } from "./styles";

export function ImportDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const confirm = useConfirmSkillImport();
  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");

  const canSubmit = body.trim().length > 0 && !confirm.isPending;

  const handleImport = async () => {
    const derivedName = name.trim() || deriveNameFromBody(body);
    await confirm.mutateAsync({
      name: derivedName,
      description: "",
      type: "custom",
      source: "imported_url",
      body: body.trim(),
    });
    notify.success(t("file.success", { name: derivedName }));
    onClose();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.drawer} onClick={(e) => e.stopPropagation()}>
        <div style={s.title}>{t("drawer.title")}</div>
        <div style={s.subtitle}>{t("drawer.subtitle")}</div>

        <div style={s.trustBanner}>
          {t("file.bodyHint")}
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
          <label style={s.label}>{t("file.bodyLabel")}</label>
          <textarea
            style={s.textarea}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("file.bodyPlaceholder")}
          />
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
