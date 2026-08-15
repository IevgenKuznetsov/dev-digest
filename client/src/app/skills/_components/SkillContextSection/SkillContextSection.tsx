/* SkillContextSection — shows context documents attached to a skill with
   attach/detach toggles and an "Attached / All documents" toggle. */
"use client";

import React from "react";
import { Skeleton, ErrorState } from "@devdigest/ui";
import {
  useSkillContext,
  useSetSkillContext,
  useContextDocs,
} from "@/lib/hooks/project-context";
import type { SkillContextDoc, ContextDoc } from "@/lib/hooks/project-context";
import { useActiveRepo } from "@/lib/repo-context";

const MAX_ATTACHED = 10;

interface SkillContextSectionProps {
  skillId: string;
}

export function SkillContextSection({ skillId }: SkillContextSectionProps) {
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id;

  const { data: attached = [], isLoading: loadingSkill, isError } = useSkillContext(skillId);
  const { data: allDocs, isLoading: loadingDocs } = useContextDocs(repoId);
  const setContext = useSetSkillContext(skillId);

  const [showAll, setShowAll] = React.useState(false);

  const attachedIds = React.useMemo(
    () => new Set((attached as SkillContextDoc[]).map((d) => d.id)),
    [attached],
  );

  const displayList: ContextDoc[] = React.useMemo(() => {
    if (showAll) return allDocs ?? [];
    return (attached as SkillContextDoc[]);
  }, [showAll, allDocs, attached]);

  const applyOrder = (ids: string[]) => {
    setContext.mutate(ids.map((id, i) => ({ contextDocId: id, order: i })));
  };

  const toggleAttach = (docId: string) => {
    const sortedAttached = [...(attached as SkillContextDoc[])].sort((a, b) => a.order - b.order);
    if (attachedIds.has(docId)) {
      applyOrder(sortedAttached.filter((d) => d.id !== docId).map((d) => d.id));
    } else {
      if (sortedAttached.length >= MAX_ATTACHED) return;
      applyOrder([...sortedAttached.map((d) => d.id), docId]);
    }
  };

  if (loadingSkill || loadingDocs) {
    return (
      <div style={{ padding: "20px 0" }}>
        <Skeleton height={180} />
      </div>
    );
  }

  if (isError) {
    return <ErrorState body="Could not load context documents for this skill." />;
  }

  if (!repoId) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
        Select a repository to manage context documents.
      </p>
    );
  }

  const totalAvailable = allDocs?.length ?? 0;

  return (
    <div style={{ paddingTop: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Project context to use</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "2px 10px",
            borderRadius: 10,
            background: "var(--accent-bg)",
            color: "var(--accent)",
          }}
        >
          {(attached as SkillContextDoc[]).length} of {totalAvailable} attached
        </span>
      </div>

      {/* Toggle: Attached / All documents */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          style={toggleBtnStyle(!showAll)}
          type="button"
          onClick={() => setShowAll(false)}
        >
          Attached
        </button>
        <button
          style={toggleBtnStyle(showAll)}
          type="button"
          onClick={() => setShowAll(true)}
        >
          All documents
        </button>
      </div>

      {/* Document list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {displayList.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {showAll ? "No context documents available. Visit Project Context to add some." : "No documents attached yet."}
          </p>
        )}
        {displayList.map((doc) => {
          const isAttached = attachedIds.has(doc.id);
          return (
            <div
              key={doc.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                background: isAttached ? "var(--bg-surface)" : "transparent",
                border: isAttached ? "1px solid var(--border)" : "1px solid transparent",
              }}
            >
              <input
                type="checkbox"
                checked={isAttached}
                onChange={() => toggleAttach(doc.id)}
                style={{ cursor: "pointer", accentColor: "var(--accent)" }}
                disabled={!isAttached && (attached as SkillContextDoc[]).length >= MAX_ATTACHED}
                aria-label={isAttached ? `Detach ${doc.path}` : `Attach ${doc.path}`}
              />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={doc.path}
              >
                {doc.path.split("/").pop()}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontFamily: "monospace",
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {doc.path}
              </span>
              <CategoryBadge category={doc.category} />
              <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                {doc.tokens} tok
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    specs: "#3b82f6",
    docs: "#22c55e",
    insights: "#f59e0b",
    other: "#94a3b8",
  };
  const c = colors[category] ?? colors.other!;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 6px",
        borderRadius: 4,
        background: c + "22",
        color: c,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        flexShrink: 0,
      }}
    >
      {category}
    </span>
  );
}

function toggleBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 12px",
    border: "1px solid var(--border)",
    borderRadius: 5,
    background: active ? "var(--accent)" : "transparent",
    color: active ? "var(--bg-page)" : "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}
