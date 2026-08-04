"use client";

import React from "react";
import { Button, ProgressBar } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

interface ConventionCardProps {
  convention: ConventionCandidate;
  repoFullName: string;
  defaultBranch: string;
  onAccept: (id: string, accepted: boolean) => void;
  disabled?: boolean;
}

/** Parse `[Category] rule text` → { category, ruleText }. */
function parseCategory(rule: string): { category: string; ruleText: string } {
  const match = rule.match(/^\[([^\]]+)\]\s*(.*)/s);
  if (match) return { category: match[1]!, ruleText: match[2]! };
  return { category: "General", ruleText: rule };
}

/** Parse `path/to/file.ts:23` → { file, line }. */
function parseEvidencePath(raw: string): { file: string; line: number | undefined } {
  const match = raw.match(/^(.+):(\d+)$/);
  if (match) return { file: match[1]!, line: Number(match[2]) };
  return { file: raw, line: undefined };
}

function confidenceColor(value: number): string {
  if (value >= 0.7) return "var(--ok)";
  if (value >= 0.4) return "var(--warn)";
  return "var(--error)";
}

export function ConventionCard({ convention, repoFullName, defaultBranch, onAccept, disabled }: ConventionCardProps) {
  const { category, ruleText } = parseCategory(convention.rule);
  const pct = Math.round(convention.confidence * 100);

  const evidence = convention.evidence_path
    ? parseEvidencePath(convention.evidence_path)
    : null;

  const blobUrl = evidence
    ? githubBlobUrl(repoFullName, defaultBranch, evidence.file, evidence.line)
    : null;

  return (
    <div style={s.card}>
      <div style={s.body}>
        <div style={s.rule}>{ruleText}</div>

        {convention.evidence_path && (
          <a
            href={blobUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            style={s.evidenceLink}
          >
            {convention.evidence_path}
          </a>
        )}

        {convention.evidence_snippet && (
          <div style={s.snippet}>{convention.evidence_snippet}</div>
        )}

        <div style={s.confidenceRow}>
          <span style={s.confidenceLabel}>Confidence</span>
          <ProgressBar
            value={pct}
            color={confidenceColor(convention.confidence)}
            height={6}
          />
          <span style={s.confidenceLabel}>{pct}%</span>
        </div>
      </div>

      <div style={s.actions}>
        {convention.accepted ? (
          <Button
            size="sm"
            kind="primary"
            onClick={() => onAccept(convention.id, false)}
            disabled={disabled}
            style={{ background: "var(--ok)", minWidth: 100 }}
          >
            ✓ Accepted
          </Button>
        ) : (
          <Button
            size="sm"
            kind="secondary"
            onClick={() => onAccept(convention.id, true)}
            disabled={disabled}
            style={{ minWidth: 100 }}
          >
            Accept
          </Button>
        )}
        {!convention.accepted && (
          <Button
            size="sm"
            kind="ghost"
            onClick={() => onAccept(convention.id, false)}
            disabled={disabled}
            style={{ fontSize: 12, color: "var(--text-muted)" }}
          >
            Reject
          </Button>
        )}
      </div>
    </div>
  );
}
