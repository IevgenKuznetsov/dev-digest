"use client";

import React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { FindingRecord, BriefFileRef, BriefReviewFocusItem } from "@devdigest/shared";
import { useRiskBrief, useGenerateRiskBrief, type RiskBriefData } from "@/lib/hooks/risk-brief";
import { RISK_LEVEL_COLORS, RISK_LEVEL_LABELS } from "./constants";
import { countBlockers, isGeneratingResponse, isBriefResponse } from "./helpers";
import { s } from "./styles";

interface PrBriefCardProps {
  prId: string;
  headSha: string;
  allFindings: FindingRecord[];
}

export function PrBriefCard({ prId, headSha, allFindings }: PrBriefCardProps) {
  const { data: rawData } = useRiskBrief(prId);
  // TanStack Query's data is undefined before the first fetch; treat as null.
  const data: RiskBriefData = rawData ?? null;
  const generateMutation = useGenerateRiskBrief(prId);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Derive state from hook data
  const isServerGenerating = isGeneratingResponse(data);
  const briefData = isBriefResponse(data) ? data : null;
  const isLocallyPending = generateMutation.isPending;
  const isFirstGeneration = !briefData && !isServerGenerating;
  const isStale = briefData != null && briefData.head_sha !== headSha;

  // Determine rendering state
  const showSkeleton = isLocallyPending && !briefData;
  const showServerGeneratingSkeleton = isServerGenerating && !briefData;
  const showOverlay = isLocallyPending && briefData != null;

  function handleFileClick(file: string, line?: number) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", "diff");
    params.set("file", file);
    if (line != null && line > 0) params.set("line", String(line));
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleGenerate() {
    generateMutation.mutate();
  }

  // ---- Empty / never-generated state ----
  if (isFirstGeneration && !showSkeleton) {
    return (
      <div style={s.card}>
        <div style={s.header}>
          <span style={s.title}>Risk Brief</span>
        </div>
        <div style={s.emptyState}>
          <span>No risk brief generated yet.</span>
          <button
            style={s.generateBtn}
            onClick={handleGenerate}
            disabled={isLocallyPending}
            aria-label="Generate risk brief"
          >
            Generate brief
          </button>
        </div>
        <FindingsSummaryRow allFindings={allFindings} />
      </div>
    );
  }

  // ---- Skeleton (first-time generating or server-generating) ----
  if (showSkeleton || showServerGeneratingSkeleton) {
    return (
      <div style={s.card}>
        <div style={s.header}>
          <span style={s.title}>Risk Brief</span>
        </div>
        <SkeletonContent />
        <FindingsSummaryRow allFindings={allFindings} />
      </div>
    );
  }

  // ---- Brief loaded ----
  if (!briefData) return null;

  const { brief } = briefData;
  const riskColors = RISK_LEVEL_COLORS[brief.risk_level];
  const riskLabel = RISK_LEVEL_LABELS[brief.risk_level];

  return (
    <div style={s.card}>
      {/* Regeneration overlay spinner */}
      {showOverlay && (
        <div
          style={s.overlay}
          role="status"
          aria-label="Regenerating brief..."
        >
          <span style={{ color: "#fff", fontSize: 13 }}>Regenerating...</span>
        </div>
      )}

      {/* Header row */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.title}>Risk Brief</span>
          <span style={s.riskBadge(riskColors.color, riskColors.bg)}>
            {riskLabel}
          </span>
          {isStale && (
            <span style={s.outdatedBadge} aria-label="Brief may be outdated">
              Outdated
            </span>
          )}
        </div>
        <button
          style={s.regenerateBtn}
          onClick={handleGenerate}
          disabled={isLocallyPending}
          aria-label="Regenerate risk brief"
        >
          Regenerate
        </button>
      </div>

      {/* What changed */}
      <div>
        <div style={s.sectionLabel}>What changed</div>
        {/* GAP-7/REQ-44/REQ-49: Plain text only — no HTML or markdown rendering */}
        <p style={s.bodyText}>{brief.what}</p>
      </div>

      {/* Why */}
      <div>
        <div style={s.sectionLabel}>Why</div>
        {/* GAP-7/REQ-44/REQ-49: Plain text only */}
        <p style={s.bodyText}>{brief.why}</p>
      </div>

      {/* Risk areas */}
      {brief.risks.length > 0 && (
        <div>
          <div style={s.sectionLabel}>Risk Areas</div>
          <div style={s.riskList}>
            {brief.risks.map((risk, idx) => (
              <div key={idx} style={s.riskItem}>
                <div style={s.riskTitle}>{risk.title}</div>
                <p style={s.riskDesc}>{risk.description}</p>
                {risk.file_refs.length > 0 && (
                  <div style={s.fileLinksRow}>
                    {risk.file_refs.map((ref, refIdx) => (
                      <FileRefLink key={refIdx} ref={ref} onClick={handleFileClick} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review focus */}
      {brief.review_focus.length > 0 && (
        <div>
          <div style={s.sectionLabel}>Review Focus</div>
          <div style={s.reviewFocusList}>
            {brief.review_focus.map((item, idx) => (
              <ReviewFocusItemRow
                key={idx}
                index={idx + 1}
                item={item}
                onClick={handleFileClick}
              />
            ))}
          </div>
        </div>
      )}

      <div style={s.divider} />

      {/* Findings/blockers summary row — always from allFindings prop (AC-U4) */}
      <FindingsSummaryRow allFindings={allFindings} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface FileRefLinkProps {
  ref: BriefFileRef;
  onClick: (file: string, line?: number) => void;
}

function FileRefLink({ ref, onClick }: FileRefLinkProps) {
  const label = ref.line != null ? `${ref.file}:${ref.line}` : ref.file;
  return (
    // GAP-5/REQ-47: Use <button> for keyboard navigation (Tab + Enter/Space)
    <button
      style={s.fileLink}
      onClick={() => onClick(ref.file, ref.line)}
      title={label}
    >
      {label}
    </button>
  );
}

interface ReviewFocusItemRowProps {
  index: number;
  item: BriefReviewFocusItem;
  onClick: (file: string, line?: number) => void;
}

function ReviewFocusItemRow({ index, item, onClick }: ReviewFocusItemRowProps) {
  const fileLabel = item.line != null ? `${item.file}:${item.line}` : item.file;
  return (
    <div style={s.reviewFocusItem}>
      <span style={s.focusIndex}>{index}.</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {/* GAP-5/REQ-47: Use <button> for keyboard navigation */}
        <button
          style={s.fileLink}
          onClick={() => onClick(item.file, item.line)}
          title={fileLabel}
        >
          {fileLabel}
        </button>
        <p style={s.focusNote}>{item.note}</p>
      </div>
    </div>
  );
}

interface FindingsSummaryRowProps {
  allFindings: FindingRecord[];
}

function FindingsSummaryRow({ allFindings }: FindingsSummaryRowProps) {
  const blockers = countBlockers(allFindings);
  const total = allFindings.length;

  if (total === 0) {
    return (
      <div style={s.findingsSummary}>
        <span style={s.findingsCount}>No findings yet</span>
      </div>
    );
  }

  return (
    <div style={s.findingsSummary}>
      <span style={s.blockersCount(blockers > 0)}>
        {blockers} {blockers === 1 ? "blocker" : "blockers"}
      </span>
      <span style={{ color: "var(--border)" }}>·</span>
      <span style={s.findingsCount}>{total} total {total === 1 ? "finding" : "findings"}</span>
    </div>
  );
}

function SkeletonContent() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...s.skeletonRow, width: "85%" }} />
      <div style={{ ...s.skeletonRow, width: "60%" }} />
      <div style={{ ...s.skeletonRow, width: "75%" }} />
      <div style={{ ...s.skeletonRow, width: "50%" }} />
    </div>
  );
}
