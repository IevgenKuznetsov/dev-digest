/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind, CreateEvalCaseInput, ExpectedOutputItem } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { extractRelevantHunks } from "../../../../../../../lib/diff-utils";
import { notify } from "../../../../../../../lib/toast";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
  highlighted,
  onCreateEvalCase,
  fileDiff,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** When true, the card shows a temporary glow highlight (auto-clears after 2s). */
  highlighted?: boolean;
  /** Called with pre-populated data when "Turn into eval case" is clicked. */
  onCreateEvalCase?: (data: Partial<CreateEvalCaseInput>) => void;
  /** The unified diff text for the finding's file (captured from the file diff view). */
  fileDiff?: string;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const [glowing, setGlowing] = React.useState(false);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;

  // When highlighted externally, auto-expand and show a temporary glow
  React.useEffect(() => {
    if (!highlighted) return;
    setExpanded(true);
    setGlowing(true);
    const timer = setTimeout(() => setGlowing(false), 2000);
    return () => clearTimeout(timer);
  }, [highlighted]);
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div data-finding-id={f.id} style={{
      ...s.card(!!focused || glowing, sevColor, muted),
      ...(glowing ? { boxShadow: `0 0 0 2px ${sevColor}, 0 0 12px ${sevColor}40` } : {}),
    }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} finding: ${f.title}`}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((v) => !v); } }}
        style={s.header}
      >
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={!accepted && !dismissed}
              onClick={() => {
                if (!fileDiff) {
                  notify.error(t("finding.evalCaseNoDiff"));
                  return;
                }
                onCreateEvalCase?.({
                  name: f.title,
                  input_diff: extractRelevantHunks(fileDiff, f.start_line, f.end_line),
                  expected_output: [
                    {
                      type: accepted ? "must_find" : "must_not_flag",
                      file: f.file,
                      start_line: f.start_line,
                      end_line: f.end_line,
                      severity: f.severity as ExpectedOutputItem["severity"],
                      category: f.category ?? undefined,
                      title: f.title,
                    },
                  ],
                });
              }}
            >
              {t("finding.turnIntoEvalCase")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
