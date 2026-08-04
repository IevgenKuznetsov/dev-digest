"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { s, typeColor } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
}) {
  const t = useTranslations("skills");
  return (
    <div onClick={onClick} style={s.card(!!active)}>
      <div style={s.headerRow}>
        <span style={s.dot(skill.enabled ? "#22c55e" : "#ef4444")} />
        <span style={s.name}>{skill.name}</span>
      </div>
      <div style={s.description}>{skill.description || "\u00A0"}</div>
      <div style={s.metaRow}>
        <span style={s.typeBadge(skill.type)}>{t(`listItem.type.${skill.type}`)}</span>
        {skill.source !== "manual" && (
          <span style={s.sourceBadge}>{t(`listItem.source.${skill.source}`)}</span>
        )}
      </div>
    </div>
  );
}
