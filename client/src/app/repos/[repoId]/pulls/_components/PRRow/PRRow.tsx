/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore, SeverityBadge, Tooltip, type Severity } from "@devdigest/ui";
import type { PrMetaFindings } from "@/lib/types";
import type { Severity as SharedSeverity } from "@devdigest/shared";
import { FindingsTooltipContent } from "../../[number]/_components/RunHistory/FindingsTooltipContent";
import { formatCost } from "../../[number]/_components/RunTraceDrawer/helpers";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";

const SEV_KEYS: { key: "critical_count" | "warning_count" | "suggestion_count"; sev: Severity }[] = [
  { key: "critical_count", sev: "CRITICAL" },
  { key: "warning_count", sev: "WARNING" },
  { key: "suggestion_count", sev: "SUGGESTION" },
];

export function PRRow({ pr, repoId }: { pr: PrMetaFindings; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {SEV_KEYS.map(({ key, sev }) => {
          const n = pr[key];
          if (n == null || n <= 0) return null;
          const filtered = (pr.findings_preview ?? []).filter(
            (f) => f.severity === sev,
          );
          return filtered.length > 0 ? (
            <Tooltip
              key={sev}
              trigger={<SeverityBadge severity={sev} count={n} compact />}
            >
              <FindingsTooltipContent
                findings={filtered}
                severity={sev as SharedSeverity}
              />
            </Tooltip>
          ) : (
            <SeverityBadge key={sev} severity={sev} count={n} compact />
          );
        })}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
        {formatCost(pr.latest_cost_usd)}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
