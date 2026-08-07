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
  onFindingClick,
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
  /** Callback when a finding badge/annotation is clicked — navigates to findings tab. */
  onFindingClick?: (findingId: string) => void;
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
  // Build a quick lookup by finding ID for passing full records to CodeLine
  const findingRecordById = React.useMemo(() => {
    if (!fileFindings?.length) return null;
    const map = new Map<string, FindingRecord>();
    for (const f of fileFindings) map.set(f.id, f);
    return map;
  }, [fileFindings]);

  const SEV_RANK: Record<LineFinding["severity"], number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };
  const SEV_BADGE: Record<LineFinding["severity"], { c: string; bg: string }> = {
    CRITICAL:   { c: "var(--crit)", bg: "var(--crit-bg)" },
    WARNING:    { c: "var(--warn)", bg: "var(--warn-bg)" },
    SUGGESTION: { c: "var(--sugg)", bg: "var(--sugg-bg)" },
  };

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
        {fileFindings && fileFindings.length > 0 && (() => {
          const bySev: Record<string, FindingRecord[]> = {};
          for (const f of fileFindings) {
            (bySev[f.severity] ??= []).push(f);
          }
          const order: LineFinding["severity"][] = ["CRITICAL", "WARNING", "SUGGESTION"];
          return order
            .filter((sev) => bySev[sev]?.length)
            .map((severity) => {
              const findings = bySev[severity]!;
              const colors = SEV_BADGE[severity];
              const sev = SEV[severity];
              const SevIcon = severity === "CRITICAL" ? Icon.AlertOctagon : severity === "WARNING" ? Icon.AlertTriangle : Icon.Lightbulb;
              return (
                <Tooltip
                  key={severity}
                  trigger={
                    <span
                      style={{ ...s.findingBadge, color: colors.c, background: colors.bg }}
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      <SevIcon size={12} />
                      {findings.length}
                    </span>
                  }
                  width={320}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: sev.c, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {sev.label} ({findings.length})
                    </div>
                    {findings.map((f) => (
                      <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 8, borderLeft: `2px solid ${sev.c}` }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                          {f.title}
                        </div>
                        <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          L{f.start_line}{f.end_line && f.end_line !== f.start_line ? `–${f.end_line}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </Tooltip>
              );
            });
        })()}
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
            (() => {
              // Track which findings have shown their badge so we can promote
              // the first visible range-only line when start_line is outside the diff.
              const badgeShown = new Set<string>();
              return lines.map((ln, i) => {
                let lineFinding = ln.newNo !== undefined
                  ? findingsMap?.get(ln.newNo) ??
                    (findingSet?.has(ln.newNo) ? { severity: "WARNING" as const, title: "" } : undefined)
                  : undefined;
                // Promote the first visible range-only line to show the badge
                if (lineFinding?.isRangeOnly && lineFinding.findingId && !badgeShown.has(lineFinding.findingId)) {
                  lineFinding = { ...lineFinding, isRangeOnly: false };
                }
                if (lineFinding && !lineFinding.isRangeOnly && lineFinding.findingId) {
                  badgeShown.add(lineFinding.findingId);
                }
                return (
                  <CodeLine
                    key={i}
                    ln={ln}
                    path={file.path}
                    threads={threadsForLine(ln, matched)}
                    commenting={commenting}
                    finding={lineFinding}
                    findingRecord={lineFinding?.findingId ? findingRecordById?.get(lineFinding.findingId) : undefined}
                    onFindingClick={onFindingClick}
                  />
                );
              });
            })()
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
