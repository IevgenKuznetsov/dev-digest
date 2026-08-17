import type { FindingRecord, RiskBriefResponse, RiskBriefGeneratingResponse } from "@devdigest/shared";
import type { RiskBriefData } from "@/lib/hooks/risk-brief";

/**
 * Count findings with CRITICAL severity (blockers).
 * AC-U3/AC-U4: Mechanically computed from findings prop, never from the brief.
 */
export function countBlockers(findings: FindingRecord[]): number {
  return findings.filter((f) => f.severity === "CRITICAL").length;
}

/**
 * Type guard: data is { status: 'generating' } (server-side in-progress).
 * EC-10/GAP-2: Distinct from locally-triggered pending state.
 */
export function isGeneratingResponse(
  data: RiskBriefData,
): data is RiskBriefGeneratingResponse {
  return data != null && "status" in data && data.status === "generating";
}

/**
 * Type guard: data is a full RiskBriefResponse with brief content.
 */
export function isBriefResponse(data: RiskBriefData): data is RiskBriefResponse {
  return data != null && "brief" in data;
}

/**
 * Parse a "file:line" string into its components.
 * Returns line as undefined if no line suffix is present or if non-numeric.
 */
export function parseFileLine(ref: string): { file: string; line?: number } {
  const match = /^(.+?):(\d+)$/.exec(ref);
  if (!match) return { file: ref };
  return { file: match[1], line: parseInt(match[2], 10) };
}
