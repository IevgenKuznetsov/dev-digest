/* AgentContextTab — shows context documents attached to an agent with
   drag-to-reorder and attach/detach toggles. */
"use client";

import React from "react";
import { Skeleton, ErrorState } from "@devdigest/ui";
import {
  useAgentContext,
  useSetAgentContext,
  useContextDocs,
} from "@/lib/hooks/project-context";
import type { AgentContextDoc, ContextDoc } from "@/lib/hooks/project-context";
import { useActiveRepo } from "@/lib/repo-context";
import { s, MAX_ATTACHED_DOCS } from "./styles";

interface AgentContextTabProps {
  agentId: string;
}

export function AgentContextTab({ agentId }: AgentContextTabProps) {
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id;

  const { data: agentCtx, isLoading: loadingCtx, isError } = useAgentContext(agentId);
  const { data: allDocs, isLoading: loadingDocs } = useContextDocs(repoId);
  const setContext = useSetAgentContext(agentId);

  const [dragIdx, setDragIdx] = React.useState<number | null>(null);

  const attached: AgentContextDoc[] = React.useMemo(
    () => (agentCtx?.attached ? [...agentCtx.attached].sort((a, b) => a.order - b.order) : []),
    [agentCtx],
  );

  const attachedIds = React.useMemo(
    () => new Set(attached.map((d) => d.id)),
    [attached],
  );

  const unattached: ContextDoc[] = React.useMemo(
    () => (allDocs ?? []).filter((d) => !attachedIds.has(d.id)),
    [allDocs, attachedIds],
  );

  const totalAvailable = agentCtx?.totalAvailable ?? allDocs?.length ?? 0;
  const totalTokens = attached.reduce((sum, d) => sum + d.tokens, 0);

  const applyOrder = (ids: string[]) => {
    setContext.mutate(
      ids.map((id, i) => ({ contextDocId: id, order: i })),
    );
  };

  const toggleAttach = (docId: string) => {
    if (attachedIds.has(docId)) {
      applyOrder(attached.filter((d) => d.id !== docId).map((d) => d.id));
    } else {
      if (attached.length >= MAX_ATTACHED_DOCS) return;
      applyOrder([...attached.map((d) => d.id), docId]);
    }
  };

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const ids = attached.map((d) => d.id);
    const [moved] = ids.splice(dragIdx, 1);
    ids.splice(targetIdx, 0, moved!);
    applyOrder(ids);
    setDragIdx(null);
  };

  if (loadingCtx || loadingDocs) {
    return (
      <div style={s.wrap}>
        <Skeleton height={200} />
      </div>
    );
  }

  if (isError) {
    return (
      <div style={s.wrap}>
        <ErrorState body="Could not load context documents." />
      </div>
    );
  }

  if (!repoId) {
    return (
      <div style={s.wrap}>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Select a repository to manage context documents.
        </span>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <span style={s.title}>Project context</span>
        <span style={s.countBadge}>
          {attached.length} of {totalAvailable} attached
        </span>
      </div>
      <div style={s.hint}>
        Order matters — earlier docs appear earlier in the assembled ## Project context
        block. Toggle to attach or detach.
      </div>

      <div style={s.list}>
        {/* Attached docs (draggable) */}
        {attached.map((doc, idx) => (
          <div
            key={doc.id}
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
              onChange={() => toggleAttach(doc.id)}
              style={s.checkbox}
              aria-label={`Detach ${doc.path}`}
            />
            <span style={s.docName} title={doc.path}>
              {doc.path.split("/").pop()}
            </span>
            <span style={s.docPath}>{doc.path}</span>
            <span style={s.categoryBadge(doc.category)}>{doc.category}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
              {doc.tokens} tok
            </span>
          </div>
        ))}

        {attached.length > 0 && unattached.length > 0 && <div style={s.separator} />}

        {/* Unattached docs */}
        {unattached.map((doc) => (
          <div key={doc.id} style={s.row(false)}>
            <span style={s.dragHandle}>&nbsp;&nbsp;</span>
            <input
              type="checkbox"
              checked={false}
              onChange={() => toggleAttach(doc.id)}
              style={s.checkbox}
              disabled={attached.length >= MAX_ATTACHED_DOCS}
              aria-label={`Attach ${doc.path}`}
            />
            <span style={s.docName} title={doc.path}>
              {doc.path.split("/").pop()}
            </span>
            <span style={s.docPath}>{doc.path}</span>
            <span style={s.categoryBadge(doc.category)}>{doc.category}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
              {doc.tokens} tok
            </span>
          </div>
        ))}

        {totalAvailable === 0 && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
            No context documents found. Visit the Project Context page to add some.
          </div>
        )}
      </div>

      {attached.length > 0 && (
        <div style={s.footer}>
          <span style={s.tokenCount}>{totalTokens.toLocaleString()} tokens</span>
          <span>Injected as an untrimmed block (## Project context) into every run.</span>
        </div>
      )}
    </div>
  );
}
