import type { ReviewRecord, FindingRecord } from "@devdigest/shared";

export interface SeverityCounts {
  CRITICAL: FindingRecord[];
  WARNING: FindingRecord[];
  SUGGESTION: FindingRecord[];
}

const EMPTY: SeverityCounts = { CRITICAL: [], WARNING: [], SUGGESTION: [] };

/**
 * Collect and group findings by severity for a specific run.
 * Matches reviews to the run via `run_id`, then partitions findings.
 */
export function findingsForRun(
  runId: string,
  reviews: ReviewRecord[],
): SeverityCounts {
  const findings = reviews
    .filter((r) => r.run_id === runId)
    .flatMap((r) => r.findings);

  if (findings.length === 0) return EMPTY;

  const result: SeverityCounts = { CRITICAL: [], WARNING: [], SUGGESTION: [] };
  for (const f of findings) {
    if (f.severity === "CRITICAL") result.CRITICAL.push(f);
    else if (f.severity === "WARNING") result.WARNING.push(f);
    else if (f.severity === "SUGGESTION") result.SUGGESTION.push(f);
  }
  return result;
}
