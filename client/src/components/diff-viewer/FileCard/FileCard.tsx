/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Tooltip, SEV } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import type { FindingRecord } from "@devdigest/shared";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine, type LineFinding } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  defaultExpanded,
  findingLines,
  findingsMap,
  fileFindings,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  defaultExpanded?: boolean;
  /** Line numbers (new-side) that have findings — highlighted in the diff. */
  findingLines?: number[];
  /** Per-line finding annotations with severity + title (overrides findingLines when present). */
  findingsMap?: Map<number, LineFinding>;
  /** Full finding records for this file — used for the tooltip on the finding badge. */
  fileFindings?: FindingRecord[];
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    defaultExpanded ?? (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  const findingSet = React.useMemo(
    () => (findingLines?.length ? new Set(findingLines) : null),
    [findingLines],
  );
  const findingCount = findingsMap?.size ?? findingLines?.length ?? 0;

  // Compute highest severity across all findings in this file for the badge color
  const SEV_RANK: Record<LineFinding["severity"], number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };
  const SEV_BADGE: Record<LineFinding["severity"], { c: string; bg: string }> = {
    CRITICAL:   { c: "var(--crit)", bg: "var(--crit-bg)" },
    WARNING:    { c: "var(--warn)", bg: "var(--warn-bg)" },
    SUGGESTION: { c: "var(--sugg)", bg: "var(--sugg-bg)" },
  };
  const highestSeverity = React.useMemo(() => {
    if (!findingsMap?.size) return null;
    let best: LineFinding["severity"] = "SUGGESTION";
    for (const f of findingsMap.values()) {
      if (SEV_RANK[f.severity] < SEV_RANK[best]) best = f.severity;
    }
    return best;
  }, [findingsMap]);

  const badgeColors = highestSeverity ? SEV_BADGE[highestSeverity] : SEV_BADGE.WARNING;

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {findingCount > 0 && (
          (() => {
            const badge = (
              <span style={{ ...s.findingBadge, color: badgeColors.c, background: badgeColors.bg }}>
                <Icon.AlertTriangle size={12} />
                {findingCount}
              </span>
            );
            // Show tooltip with top finding (highest severity) if we have full finding data
            const topFinding = fileFindings?.length
              ? fileFindings.reduce((best, f) => (SEV_RANK[f.severity as LineFinding["severity"]] < SEV_RANK[best.severity as LineFinding["severity"]] ? f : best))
              : null;
            if (!topFinding) return badge;
            const sev = SEV[topFinding.severity as keyof typeof SEV];
            return (
              <Tooltip
                trigger={badge}
                width={300}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: sev.c, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {sev.label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {topFinding.title}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {topFinding.file}:{topFinding.start_line}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                      {Math.round(topFinding.confidence * 100)}% conf
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                    {topFinding.rationale.length > 120 ? topFinding.rationale.slice(0, 120) + "..." : topFinding.rationale}
                  </div>
                </div>
              </Tooltip>
            );
          })()
        )}
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => {
              const lineFinding = ln.newNo !== undefined
                ? findingsMap?.get(ln.newNo) ??
                  (findingSet?.has(ln.newNo) ? { severity: "WARNING" as const, title: "" } : undefined)
                : undefined;
              return (
                <CodeLine
                  key={i}
                  ln={ln}
                  path={file.path}
                  threads={threadsForLine(ln, matched)}
                  commenting={commenting}
                  finding={lineFinding}
                />
              );
            })
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
