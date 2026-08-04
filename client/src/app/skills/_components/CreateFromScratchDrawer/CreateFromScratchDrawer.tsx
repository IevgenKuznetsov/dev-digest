"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../lib/hooks/skills";
import { notify } from "../../../../lib/toast";
import { s } from "../ImportDrawer/styles";

const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];

export function CreateFromScratchDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");

  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && !create.isPending;

  const handleCreate = async () => {
    await create.mutateAsync({
      name: name.trim(),
      description: description.trim(),
      type,
      source: "manual",
      body: body.trim(),
    });
    notify.success(t("file.success", { name: name.trim() }));
    onClose();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.drawer} onClick={(e) => e.stopPropagation()}>
        <div style={s.title}>Create from scratch</div>
        <div style={s.subtitle}>Define a new skill with custom rules.</div>

        <div style={s.formGroup}>
          <label style={s.label}>{t("file.nameLabel")}</label>
          <input
            style={s.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("file.namePlaceholder")}
            autoFocus
          />
        </div>

        <div style={s.formGroup}>
          <label style={s.label}>Description</label>
          <input
            style={s.input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of what this skill checks"
          />
        </div>

        <div style={s.formGroup}>
          <label style={s.label}>Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as SkillType)}
            style={{ ...s.input, cursor: "pointer" }}
          >
            {SKILL_TYPES.map((st) => (
              <option key={st} value={st}>
                {t(`listItem.type.${st}`)}
              </option>
            ))}
          </select>
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
          <Button kind="primary" size="sm" disabled={!canSubmit} onClick={handleCreate}>
            {create.isPending ? "Creating…" : "Create skill"}
          </Button>
        </div>
      </div>
    </div>
  );
}
