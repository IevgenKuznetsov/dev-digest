import React from "react";
import { CategoryTag, SEV } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";

const MAX_RATIONALE = 120;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

export function FindingsTooltipContent({
  findings,
  severity,
}: {
  findings: FindingRecord[];
  severity: Severity;
}) {
  const sev = SEV[severity];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: sev.c,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {findings.length} {sev.label}
      </div>

      {findings.map((f) => {
        const muted = !!f.accepted_at || !!f.dismissed_at;
        return (
          <div
            key={f.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              opacity: muted ? 0.6 : 1,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {f.title}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CategoryTag category={f.category as any} />
              {f.file && (
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--text-muted)" }}
                >
                  {f.file}:{f.start_line}
                </span>
              )}
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginLeft: "auto",
                }}
              >
                {Math.round(f.confidence * 100)}% conf
              </span>
            </div>

            <div
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                lineHeight: 1.4,
              }}
            >
              {truncate(f.rationale, MAX_RATIONALE)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
