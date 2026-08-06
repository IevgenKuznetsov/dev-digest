"use client";

import React from "react";
import { Badge, Button } from "@devdigest/ui";
import type { EnrichedIntent, IntentConfidence } from "@devdigest/shared";
import { usePrIntent, useClassifyIntent } from "@/lib/hooks/reviews";

// ---- Constants -------------------------------------------------------

const CONFIDENCE_BADGE: Record<
  Exclude<IntentConfidence, "high">,
  { label: string; color: string; bg: string }
> = {
  medium: {
    label: "Medium confidence",
    color: "var(--warning)",
    bg: "rgba(var(--warning-rgb, 245,158,11), 0.12)",
  },
  low: {
    label: "Low confidence",
    color: "var(--text-muted)",
    bg: "var(--bg-hover)",
  },
};

// ---- Styles ----------------------------------------------------------

const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
  },
  summary: {
    fontSize: 14,
    color: "var(--text-primary)",
    fontStyle: "italic",
    lineHeight: 1.5,
    paddingLeft: 4,
    borderLeft: "2px solid var(--border-strong)",
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  columnLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    marginBottom: 6,
  },
  columnLabelIn: {
    color: "var(--success, #22c55e)",
  },
  columnLabelOut: {
    color: "var(--text-muted)",
  },
  scopeList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  },
  scopeItem: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
  },
  scopeItemIn: {
    paddingLeft: 14,
    position: "relative" as const,
  },
  scopeItemOut: {
    paddingLeft: 14,
    position: "relative" as const,
    color: "var(--text-muted)",
  },
  riskSection: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  riskLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--warning, #f59e0b)",
  },
  riskTags: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
  },
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
};

// ---- Sub-components --------------------------------------------------

function ScopeColumn({
  label,
  items,
  isIn,
}: {
  label: string;
  items: string[];
  isIn: boolean;
}) {
  return (
    <div>
      <div
        style={{
          ...s.columnLabel,
          ...(isIn ? s.columnLabelIn : s.columnLabelOut),
        }}
      >
        {isIn ? "✓ " : "✗ "}
        {label}
      </div>
      {items.length === 0 ? (
        <span style={s.empty}>—</span>
      ) : (
        <ul style={s.scopeList}>
          {items.map((item, i) => (
            <li
              key={i}
              style={{ ...s.scopeItem, ...(isIn ? s.scopeItemIn : s.scopeItemOut) }}
            >
              · {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Main component --------------------------------------------------

interface IntentCardProps {
  prId: string;
}

export function IntentCard({ prId }: IntentCardProps) {
  const { data: intent, isLoading, isError, error } = usePrIntent(prId);
  const classify = useClassifyIntent(prId);

  // 404 = not classified yet — show nothing (not an error state)
  if (isError) {
    const status = (error as { status?: number })?.status;
    if (status === 404) return null;
    return null; // other errors are silent too
  }

  if (isLoading) {
    return (
      <div style={s.card}>
        <div style={s.header}>
          <span style={s.title}>⚡ Intent</span>
        </div>
        <div style={{ ...s.empty, fontStyle: "normal" }}>Loading intent…</div>
      </div>
    );
  }

  if (!intent) return null;

  const showConfidenceBadge = intent.confidence !== "high";
  const confidenceBadge = showConfidenceBadge
    ? CONFIDENCE_BADGE[intent.confidence as Exclude<IntentConfidence, "high">]
    : null;

  return (
    <div style={s.card}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.title}>⚡ Intent</span>
          {confidenceBadge && (
            <Badge color={confidenceBadge.color} bg={confidenceBadge.bg}>
              {confidenceBadge.label}
            </Badge>
          )}
        </div>
        <Button
          kind="ghost"
          size="sm"
          onClick={() => classify.mutate()}
          disabled={classify.isPending}
        >
          {classify.isPending ? "Classifying…" : "Re-classify"}
        </Button>
      </div>

      {/* Summary */}
      <div style={s.summary}>"{intent.summary}"</div>

      {/* In scope / Out of scope */}
      <div style={s.columns}>
        <ScopeColumn label="In Scope" items={intent.in_scope} isIn={true} />
        <ScopeColumn label="Out of Scope" items={intent.out_of_scope} isIn={false} />
      </div>

      {/* Risk areas */}
      {intent.risk_areas.length > 0 && (
        <div style={s.riskSection}>
          <div style={s.riskLabel}>⚠ Risk Areas</div>
          <div style={s.riskTags}>
            {intent.risk_areas.map((area: string, i: number) => (
              <Badge key={i} color="var(--warning, #f59e0b)" bg="rgba(245,158,11,0.1)">
                {area}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
