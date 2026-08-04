/* SkillsTab — bind, enable/disable, and reorder skills for an agent.
   Order determines sequence of skill blocks in the assembled prompt. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Agent, Skill } from "@devdigest/shared";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { useSkills, useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/skills";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data: allSkills, isLoading: loadingSkills, isError } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();
  const [filter, setFilter] = React.useState("");
  const [dragIdx, setDragIdx] = React.useState<number | null>(null);

  const sortedLinks = React.useMemo(
    () => (links ? [...links].sort((a, b) => a.order - b.order) : []),
    [links],
  );

  const linkedIds = React.useMemo(
    () => new Set(sortedLinks.map((l) => l.skill_id)),
    [sortedLinks],
  );

  const orderedLinked = React.useMemo<Skill[]>(() => {
    const list = allSkills ?? [];
    return sortedLinks
      .map((l) => list.find((sk: Skill) => sk.id === l.skill_id))
      .filter((sk): sk is Skill => sk != null);
  }, [allSkills, sortedLinks]);

  const unlinked = React.useMemo<Skill[]>(() => {
    const list = allSkills ?? [];
    return list
      .filter((sk: Skill) => !linkedIds.has(sk.id))
      .sort((a: Skill, b: Skill) => a.name.localeCompare(b.name));
  }, [allSkills, linkedIds]);

  const q = filter.toLowerCase();
  const filterFn = (sk: Skill) => !q || sk.name.toLowerCase().includes(q);

  const toggleSkill = (skillId: string) => {
    const current = orderedLinked.map((sk) => sk.id);
    const next = linkedIds.has(skillId)
      ? current.filter((id) => id !== skillId)
      : [...current, skillId];
    setSkills.mutate({ agentId: agent.id, skillIds: next });
  };

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const ids = orderedLinked.map((sk) => sk.id);
    const [moved] = ids.splice(dragIdx, 1);
    ids.splice(targetIdx, 0, moved!);
    setSkills.mutate({ agentId: agent.id, skillIds: ids });
    setDragIdx(null);
  };

  if (loadingSkills) return <div style={s.wrap}><Skeleton height={200} /></div>;
  if (isError) return <div style={s.wrap}><ErrorState body="Could not load skills." /></div>;

  const total = allSkills?.length ?? 0;

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <span style={s.title}>{t("skills.title")}</span>
        <span style={s.countBadge}>
          {t("skills.enabledCount", { linked: linkedIds.size, total })}
        </span>
        <div style={s.filterWrap} />
        <input
          style={s.filterInput}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("skills.filterPlaceholder")}
        />
      </div>
      <div style={s.hint}>{t("skills.orderHint")}</div>

      <div style={s.list}>
        {orderedLinked.filter(filterFn).map((sk, idx) => (
          <div
            key={sk.id}
            style={s.row(true)}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(idx)}
          >
            <span style={s.dragHandle}>&#x2261;</span>
            <input
              type="checkbox"
              checked
              onChange={() => toggleSkill(sk.id)}
              style={s.checkbox}
            />
            <span style={s.skillName}>{sk.name}</span>
            <span style={s.typeBadge(sk.type)}>{sk.type}</span>
          </div>
        ))}

        {orderedLinked.length > 0 && unlinked.filter(filterFn).length > 0 && (
          <div style={s.separator} />
        )}

        {unlinked.filter(filterFn).map((sk) => (
          <div key={sk.id} style={s.row(false)}>
            <span style={s.dragHandle}>&nbsp;&nbsp;</span>
            <input
              type="checkbox"
              checked={false}
              onChange={() => toggleSkill(sk.id)}
              style={s.checkbox}
            />
            <span style={s.skillName}>{sk.name}</span>
            <span style={s.typeBadge(sk.type)}>{sk.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
