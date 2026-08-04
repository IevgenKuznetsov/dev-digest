"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton } from "@devdigest/ui";
import { useCommunitySkills, useConfirmSkillImport, type CommunitySkill } from "../../../../lib/hooks/skills";
import { notify } from "../../../../lib/toast";
import { s } from "./styles";

const LANG_FILTERS = ["All languages", "TypeScript", "Python", "Go", "Rust", "CSS"];
const CATEGORY_FILTERS = ["security", "performance"];

export function CommunitySearchDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const [query, setQuery] = React.useState("");
  const [lang, setLang] = React.useState("all");
  const { data: results, isLoading, isError, refetch } = useCommunitySkills(query, lang);
  const confirm = useConfirmSkillImport();
  const [importingName, setImportingName] = React.useState<string | null>(null);

  const handleImport = async (skill: CommunitySkill) => {
    setImportingName(skill.name);
    try {
      await confirm.mutateAsync({
        name: skill.name,
        description: skill.desc,
        type: "custom",
        source: "community",
        body: skill.body,
      });
      notify.success(t("file.success", { name: skill.name }));
    } finally {
      setImportingName(null);
    }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.drawer} onClick={(e) => e.stopPropagation()}>
        <div style={s.title}>Search community skills</div>
        <div style={s.subtitle}>Import vetted skills from public repos</div>

        <div style={s.searchWrap}>
          <input
            style={s.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("community.searchPlaceholder")}
            autoFocus
          />
        </div>

        {/* Filter chips */}
        <div style={s.chipRow}>
          {LANG_FILTERS.map((l) => {
            const val = l === "All languages" ? "all" : l;
            const active = lang.toLowerCase() === val.toLowerCase();
            return (
              <button
                key={l}
                style={s.chip(active)}
                onClick={() => setLang(val.toLowerCase() === "all" ? "all" : val)}
              >
                {l === "All languages" ? t("community.allLanguages") : l}
              </button>
            );
          })}
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c}
              style={s.chip(query === c)}
              onClick={() => setQuery(query === c ? "" : c)}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Results */}
        <div style={s.resultsList}>
          {isLoading && (
            <>
              <Skeleton height={80} />
              <Skeleton height={80} />
              <Skeleton height={80} />
            </>
          )}
          {isError && (
            <div style={{ textAlign: "center", padding: 20 }}>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 8 }}>
                {t("community.loadError")}
              </p>
              <Button kind="ghost" size="sm" onClick={() => refetch()}>
                {t("community.retry")}
              </Button>
            </div>
          )}
          {!isLoading && !isError && results?.length === 0 && (
            <div style={{ textAlign: "center", padding: 32 }}>
              <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                {t("community.noMatch.title")}
              </p>
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                {t("community.noMatch.body")}
              </p>
            </div>
          )}
          {results?.map((skill) => (
            <div key={skill.name} style={s.resultCard}>
              <div style={s.resultHeader}>
                <span style={s.resultName}>{skill.name}</span>
                <span style={s.resultStars}>&#9734; {skill.stars.toLocaleString()}</span>
              </div>
              <div style={s.resultDesc}>{skill.desc}</div>
              <div style={s.resultFooter}>
                <span style={s.resultRepo}>{skill.repo}</span>
                <span style={s.resultLang}>{skill.lang}</span>
                <div style={{ flex: 1 }} />
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Plus"
                  disabled={importingName === skill.name}
                  onClick={() => handleImport(skill)}
                >
                  {importingName === skill.name ? t("community.importing") : t("community.import")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
