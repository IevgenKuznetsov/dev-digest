"use client";

import React from "react";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, useSmartDiff, usePrReviews } from "@/lib/hooks/reviews";
import { useRiskBrief } from "@/lib/hooks/risk-brief";
import { SmartDiffViewer } from "./_components/SmartDiffViewer";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import type { CSSProperties } from "react";

const segmentedControl: CSSProperties = {
  display: "flex",
  alignItems: "center",
  border: "1px solid var(--border)",
  borderRadius: 6,
  overflow: "hidden",
};

function segmentBtn(active: boolean, disabled?: boolean): CSSProperties {
  return {
    padding: "3px 10px",
    fontSize: 12,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "none",
    background: active ? "var(--accent-bg)" : "transparent",
    color: disabled ? "var(--text-muted)" : active ? "var(--accent)" : "var(--text-secondary)",
    opacity: disabled ? 0.5 : 1,
    transition: "background 0.15s, color 0.15s",
  };
}

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Callback when a finding badge is clicked — navigates to findings tab. */
  onFindingClick?: (findingId: string) => void;
}

export function DiffTab({ prId, filesCount, files, canComment, onFindingClick }: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const { data: smartDiff, isLoading: smartDiffLoading } = useSmartDiff(prId);
  const { data: reviews } = usePrReviews(prId);
  const { data: rawBrief } = useRiskBrief(prId);
  // Flatten all findings from reviews for severity annotations in Smart Diff
  const allFindings = React.useMemo(
    () => (reviews ?? []).flatMap((r) => r.findings),
    [reviews],
  );
  // Map each file to its review_focus note from the risk brief — shown as "What this does" in Smart Diff.
  // Keys are lowercased for case-insensitive lookup (GitHub and LLM paths may differ in case).
  const reviewNoteByFile = React.useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    if (!rawBrief || !("brief" in rawBrief)) return map;
    for (const item of rawBrief.brief.review_focus) {
      const key = item.file.toLowerCase();
      if (!map.has(key)) map.set(key, item.note);
    }
    return map;
  }, [rawBrief]);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Toggle between grouped (Smart Diff) and flat view. Default to grouped when data is ready.
  const [groupedView, setGroupedView] = React.useState(true);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const showGrouped = groupedView && !!smartDiff && !smartDiffLoading;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={segmentedControl}>
              <button
                style={segmentBtn(!groupedView)}
                onClick={() => setGroupedView(false)}
              >
                Flat
              </button>
              <button
                style={segmentBtn(groupedView, !smartDiff || smartDiffLoading)}
                disabled={!smartDiff || smartDiffLoading}
                onClick={() => setGroupedView(true)}
              >
                Smart Diff
              </button>
            </div>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {showGrouped ? (
        <SmartDiffViewer groups={smartDiff!.groups} files={files} prId={prId} commenting={commenting} findings={allFindings} onFindingClick={onFindingClick} />
      ) : (
        <DiffViewer files={files} commenting={commenting} reviewNoteByFile={reviewNoteByFile} />
      )}
    </section>
  );
}
