/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { Tooltip, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

/** Finding annotation anchored to this line (severity + title). */
export interface LineFinding {
  severity: "CRITICAL" | "WARNING" | "SUGGESTION";
  title: string;
  /** ID of the FindingRecord — enables click-to-navigate to the findings tab. */
  findingId?: string;
  /** review_id that owns this finding — used to open the correct ReviewRunAccordion. */
  reviewId?: string;
  /** True for continuation lines in a multi-line finding range (highlight only, no badge). */
  isRangeOnly?: boolean;
}

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  finding,
  findingRecord,
  onFindingClick,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Finding annotation for this line — highlights row and shows label on the right. */
  finding?: LineFinding;
  /** Full finding record — enables tooltip on annotation. */
  findingRecord?: FindingRecord;
  /** Callback when the finding annotation is clicked (navigates to findings tab). */
  onFindingClick?: (findingId: string) => void;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={lineRowFor(ln.kind, finding?.severity)}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {finding && !finding.isRangeOnly && (() => {
          const label = finding.severity === "CRITICAL" ? "Blocker" : finding.severity === "WARNING" ? "Warning" : "Suggestion";
          const clickable = !!(finding.findingId && onFindingClick);
          const annotation = (
            <span
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              style={{ ...s.findingAnnotation, cursor: clickable ? "pointer" : undefined }}
              onClick={clickable ? (e: React.MouseEvent) => { e.stopPropagation(); onFindingClick!(finding.findingId!); } : undefined}
              onKeyDown={clickable ? (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onFindingClick!(finding.findingId!); } } : undefined}
            >
              <span style={s.findingDot(finding.severity)} />
              <span style={s.findingLabel}>{label}</span>
            </span>
          );
          if (!findingRecord) return annotation;
          const sev = SEV[findingRecord.severity as keyof typeof SEV];
          return (
            <Tooltip trigger={annotation} width={300}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: sev.c, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {sev.label}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {findingRecord.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {findingRecord.file}:{findingRecord.start_line}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                    {Math.round(findingRecord.confidence * 100)}% conf
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                  {findingRecord.rationale.length > 120 ? findingRecord.rationale.slice(0, 120) + "..." : findingRecord.rationale}
                </div>
              </div>
            </Tooltip>
          );
        })()}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
