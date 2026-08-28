/* /skills — Two-panel skill list + config editor (matches agent editor layout).
   Left: scrollable skill cards with search + Add button.
   Right: skill detail with tabs (Config, Preview, Evals, Stats, Versions). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon, Badge, Toggle, Markdown, Donut } from "@devdigest/ui";
import { useRouter } from "next/navigation";
import type { Skill, SkillType } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell";
import {
  useSkills,
  useUpdateSkill,
  useDeleteSkill,
  useSkillVersions,
  useRestoreSkillVersion,
  useSkillEvalCases,
  useSkillStats,
} from "../../../../lib/hooks/skills";
import { SkillCard } from "./_components/SkillCard";
import { ImportDrawer } from "../ImportDrawer";
import { ImportFromUrlDrawer } from "../ImportFromUrlDrawer";
import { CommunitySearchDrawer } from "../CommunitySearchDrawer";
import { CreateFromScratchDrawer } from "../CreateFromScratchDrawer";
import { SkillContextSection } from "../SkillContextSection";
import { s } from "./styles";

const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];
const TABS = ["config", "preview", "evals", "stats", "versions", "context"] as const;
type Tab = (typeof TABS)[number];

export function SkillsListView() {
  const t = useTranslations("skills");
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [importingUrl, setImportingUrl] = React.useState(false);
  const [communitySearch, setCommunitySearch] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>("config");

  const filtered = React.useMemo(() => {
    if (!skills) return [];
    const q = search.toLowerCase();
    return q ? skills.filter((sk) => sk.name.toLowerCase().includes(q)) : skills;
  }, [skills, search]);

  const selected = skills?.find((sk) => sk.id === selectedId) ?? null;

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {importing && <ImportDrawer onClose={() => setImporting(false)} />}
      {importingUrl && <ImportFromUrlDrawer onClose={() => setImportingUrl(false)} />}
      {communitySearch && <CommunitySearchDrawer onClose={() => setCommunitySearch(false)} />}
      {creating && <CreateFromScratchDrawer onClose={() => setCreating(false)} />}
      <div style={s.wrap}>
        {/* ---- Left sidebar ---- */}
        <div style={s.sidebar}>
          <div style={s.sidebarHeader}>
            <div style={s.sidebarTitleRow}>
              <h1 style={s.h1}>{t("page.heading")}</h1>
              <Dropdown
                width={220}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus">
                    {t("page.addSkill")}
                  </Button>
                }
                items={[
                  { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setImporting(true) },
                  { label: t("page.menu.fromUrl"), icon: "Link", onClick: () => setImportingUrl(true) },
                  { label: t("page.menu.community"), icon: "Globe", onClick: () => setCommunitySearch(true) },
                  { divider: true },
                  { label: "Create from scratch", icon: "Edit", onClick: () => setCreating(true) },
                ]}
              />
            </div>
            <div style={s.search}>
              <Icon.Search size={13} style={s.searchIcon} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                style={s.searchInput}
              />
            </div>
          </div>
          <div style={s.sidebarList}>
            {isLoading && (
              <>
                <Skeleton height={70} />
                <Skeleton height={70} />
                <Skeleton height={70} />
              </>
            )}
            {!isLoading && filtered.length === 0 && !search && (
              <div style={{ padding: "20px 8px", textAlign: "center" as const, color: "var(--text-muted)", fontSize: 13 }}>
                No skills yet. Import one to get started.
              </div>
            )}
            {filtered.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === selectedId}
                onClick={() => { setSelectedId(sk.id); setTab("config"); }}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        {/* ---- Right detail panel ---- */}
        {!selected ? (
          <div style={s.detailPlaceholder}>
            <div style={{ textAlign: "center" as const }}>
              <p>{t("page.selectPrompt.title")}</p>
              <p style={{ marginTop: 4, fontSize: 13 }}>{t("page.selectPrompt.body")}</p>
            </div>
          </div>
        ) : (
          <SkillDetail
            skill={selected}
            tab={tab}
            onTab={setTab}
            onSave={(id, patch) => update.mutate({ id, patch })}
            onDelete={(id) => {
              if (window.confirm("Delete this skill? This cannot be undone.")) {
                del.mutate(id);
                setSelectedId(null);
              }
            }}
            saving={update.isPending}
          />
        )}
      </div>
    </AppShell>
  );
}

/* ---- Detail panel with tabs ---- */

function SkillDetail({
  skill,
  tab,
  onTab,
  onSave,
  onDelete,
  saving,
}: {
  skill: Skill;
  tab: Tab;
  onTab: (t: Tab) => void;
  onSave: (id: string, patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>) => void;
  onDelete: (id: string) => void;
  saving: boolean;
}) {
  const t = useTranslations("skills");

  return (
    <div style={s.detail}>
      {/* Header */}
      <div style={s.detailHeader}>
        <h1 style={s.detailName}>{skill.name}</h1>
        <span style={s.typeBadge(skill.type)}>{t(`listItem.type.${skill.type}`)}</span>
        <Badge color="var(--text-muted)" mono>v{skill.version}</Badge>
      </div>

      {/* Tab bar */}
      <div style={s.tabBar}>
        {TABS.map((key) => (
          <button key={key} style={s.tab(tab === key)} onClick={() => onTab(key)}>
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "config" && (
        <ConfigTab skill={skill} onSave={onSave} onDelete={onDelete} saving={saving} />
      )}
      {tab === "preview" && <PreviewTab skill={skill} />}
      {tab === "evals" && <EvalsTab skill={skill} />}
      {tab === "stats" && <StatsTab skill={skill} />}
      {tab === "versions" && <VersionsTab skill={skill} />}
      {tab === "context" && (
        <div style={s.configPanel}>
          <SkillContextSection skillId={skill.id} />
        </div>
      )}
    </div>
  );
}

/* ---- Config Tab ---- */

function ConfigTab({
  skill,
  onSave,
  onDelete,
  saving,
}: {
  skill: Skill;
  onSave: (id: string, patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>) => void;
  onDelete: (id: string) => void;
  saving: boolean;
}) {
  const t = useTranslations("skills");
  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);

  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = name !== skill.name || description !== skill.description || type !== skill.type || body !== skill.body;

  return (
    <div style={s.configPanel}>
      <div style={s.configHeadingRow}>
        <h2 style={s.configHeading}>Configuration</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {skill.enabled ? t("preview.enabled") : t("preview.disabled")}
          </span>
          <Toggle
            on={skill.enabled}
            onChange={(enabled: boolean) => onSave(skill.id, { enabled })}
            size={16}
          />
        </div>
      </div>

      <div style={s.formGroup}>
        <div style={s.label}>Name *</div>
        <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div style={s.formGroup}>
        <div style={s.label}>Description</div>
        <input style={s.input} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div style={s.formGroup}>
        <div style={s.label}>Type</div>
        <select
          style={s.input}
          value={type}
          onChange={(e) => setType(e.target.value as SkillType)}
        >
          {SKILL_TYPES.map((tp) => (
            <option key={tp} value={tp}>
              {t(`listItem.type.${tp}`)}
            </option>
          ))}
        </select>
      </div>

      <div style={s.formGroup}>
        <div style={s.bodyHeader}>
          <span style={s.bodyLabel}>Skill body *</span>
          <span style={s.bodyFileBadge}>{skill.name.toLowerCase().replace(/\s+/g, "-")}.md</span>
        </div>
        <textarea style={s.textarea} value={body} onChange={(e) => setBody(e.target.value)} />
        <div style={s.hint}>{t("preview.bodyHint")}</div>
      </div>

      <div style={s.saveRow}>
        <Button kind="ghost" size="sm" onClick={() => onDelete(skill.id)}>
          Delete
        </Button>
        <Button
          kind="primary"
          size="sm"
          disabled={!changed || saving}
          onClick={() => onSave(skill.id, { name, description, type, body })}
        >
          {saving ? "Saving\u2026" : t("preview.save")}
        </Button>
      </div>
    </div>
  );
}

/* ---- Preview Tab ---- */

function PreviewTab({ skill }: { skill: Skill }) {
  return (
    <div style={s.configPanel}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Preview</h2>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
        Rendered as the reviewing agent receives it.
      </p>
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "20px 24px",
          fontSize: 14,
        }}
      >
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}

/* ---- Evals Tab ---- */

function EvalsTab({ skill }: { skill: Skill }) {
  const { data: cases, isLoading } = useSkillEvalCases(skill.id);
  const total = cases?.length ?? 0;

  return (
    <div style={s.configPanel}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>
          Eval cases
          {total > 0 && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--text-muted)",
                marginLeft: 8,
              }}
            >
              {total} case{total !== 1 ? "s" : ""}
            </span>
          )}
        </h2>
        <Button kind="secondary" size="sm" icon="Play" disabled>
          Run all
        </Button>
        <Button kind="primary" size="sm" icon="Plus" disabled>
          New eval case
        </Button>
      </div>

      {isLoading && (
        <>
          <Skeleton height={52} />
          <Skeleton height={52} />
        </>
      )}

      {!isLoading && total === 0 && (
        <EmptyState
          icon="Sparkles"
          title="No eval cases yet"
          body="Create eval cases to test this skill against sample diffs and verify it produces the expected findings."
        />
      )}

      {!isLoading && cases && cases.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cases.map((ec) => (
            <div
              key={ec.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <Icon.Dot size={10} style={{ color: "var(--text-muted)" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{ec.name}</div>
                {ec.notes && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{ec.notes}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- Stats Tab ---- */

const CATEGORY_COLORS: Record<string, string> = {
  security: "#f59e0b",
  bug: "#ef4444",
  perf: "#3b82f6",
  style: "#a855f7",
  test: "#22c55e",
};

function StatsTab({ skill }: { skill: Skill }) {
  const { data: stats, isLoading } = useSkillStats(skill.id);
  const router = useRouter();

  if (isLoading) {
    return (
      <div style={s.configPanel}>
        <Skeleton height={80} />
        <Skeleton height={120} />
      </div>
    );
  }

  const agents = stats?.used_by_agents ?? [];
  const byCat = stats?.findings_by_category ?? {};
  const donutSegments = Object.entries(byCat).map(([label, value]) => ({
    label,
    value,
    color: CATEGORY_COLORS[label] ?? "#94a3b8",
  }));

  return (
    <div style={s.configPanel}>
      {/* Stat cards row */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        <StatCard label="USED BY" value={`${stats?.agents_count ?? 0}`} sub="agents" />
        <StatCard
          label="PULL FREQUENCY"
          value={stats?.pull_frequency != null ? `${stats.pull_frequency}` : "—"}
          sub="%"
        />
        <StatCard
          label="ACCEPT RATE"
          value={stats?.accept_rate != null ? `${stats.accept_rate}` : "—"}
          sub="%"
        />
        <StatCard
          label={`FINDINGS${stats?.findings_total ? ` (${stats.findings_total})` : ""}`}
          value={`${stats?.findings_total ?? 0}`}
          sub=""
        />
      </div>

      {/* Bottom two-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Agents using this skill */}
        <div
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 12 }}>
            AGENTS USING THIS SKILL
          </h3>
          {agents.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              No agents are using this skill yet. Link it from the agent&apos;s Skills tab.
            </p>
          )}
          {agents.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 0",
                borderBottom: "1px solid var(--border)",
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600, flex: 1 }}>{a.name}</span>
              <button
                onClick={() => router.push(`/agents/${a.id}`)}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "4px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                Open
              </button>
            </div>
          ))}
        </div>

        {/* Findings by category */}
        <div
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 12 }}>
            FINDINGS BY CATEGORY
          </h3>
          {donutSegments.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No findings yet.</p>
          ) : (
            <Donut segments={donutSegments} valuePrefix="" />
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "16px 20px",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 700 }}>{value}</span>
        {sub && <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{sub}</span>}
      </div>
    </div>
  );
}

/* ---- Versions Tab ---- */

function VersionsTab({ skill }: { skill: Skill }) {
  const { data: versions, isLoading } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();

  if (isLoading) {
    return (
      <div style={s.configPanel}>
        <Skeleton height={60} />
        <Skeleton height={60} />
        <Skeleton height={60} />
      </div>
    );
  }

  const list = versions ?? [];

  return (
    <div style={s.configPanel}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>Version history</h2>
        <Badge color="var(--text-muted)" mono>{list.length} version{list.length !== 1 ? "s" : ""}</Badge>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
        Every save snapshots the body so eval runs stay reproducible against the exact text they scored.
      </p>

      {list.length === 0 && (
        <EmptyState icon="Sparkles" title="No versions yet" body="Save the skill body to create the first version." />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((v) => {
          const isCurrent = v.version === skill.version;
          return (
            <div
              key={v.version}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                background: "var(--bg)",
                border: isCurrent ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>v{v.version}</span>
                  {isCurrent && (
                    <Badge color="#22c55e">Current</Badge>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  {new Date(v.createdAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              </div>
              {!isCurrent && (
                <Button
                  kind="secondary"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() => {
                    if (window.confirm(`Restore v${v.version}? This will create a new version with the old body.`)) {
                      restore.mutate({ skillId: skill.id, version: v.version });
                    }
                  }}
                >
                  Restore
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
