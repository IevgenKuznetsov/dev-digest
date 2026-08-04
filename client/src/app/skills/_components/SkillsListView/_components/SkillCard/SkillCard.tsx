"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "../../../../../../lib/hooks/skills";
import { s, typeColor } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const { data: stats } = useSkillStats(skill.id);

  return (
    <div onClick={onClick} style={s.card(!!active)}>
      <div style={s.headerRow}>
        <span style={s.dot(skill.enabled ? "#22c55e" : "#ef4444")} />
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle
              on={skill.enabled}
              onChange={onToggle}
              size={14}
            />
          </div>
        )}
      </div>
      <div style={s.description}>{skill.description || "\u00A0"}</div>
      <div style={s.metaRow}>
        <span style={s.typeBadge(skill.type)}>{t(`listItem.type.${skill.type}`)}</span>
        {skill.source !== "manual" && (
          <span style={s.sourceBadge}>{t(`listItem.source.${skill.source}`)}</span>
        )}
      </div>
      {stats && (
        <div style={s.statsRow}>
          <span>{stats.agents_count} agent{stats.agents_count !== 1 ? "s" : ""}</span>
          <span>{stats.pull_frequency != null ? `${stats.pull_frequency}% pull` : ""}</span>
          <span style={{ color: stats.accept_rate != null && stats.accept_rate >= 70 ? "#22c55e" : "var(--text-muted)" }}>
            {stats.accept_rate != null ? `${stats.accept_rate}% accept` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
