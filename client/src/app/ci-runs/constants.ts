/* ci-runs/constants.ts — page-scoped constants. */

/** Column keys for the CI Runs table (AC-E7). */
export const COLUMN_KEYS = [
  "repository",
  "pr",
  "agent",
  "source",
  "duration",
  "findings",
  "cost",
  "status",
  "link",
] as const;

export type ColumnKey = (typeof COLUMN_KEYS)[number];

/** Column header labels aligned to COLUMN_KEYS. */
export const COLUMN_LABELS: Record<ColumnKey, string> = {
  repository: "Repository",
  pr: "PR",
  agent: "Agent",
  source: "Source",
  duration: "Duration",
  findings: "Findings",
  cost: "Cost",
  status: "Status",
  link: "Trace / Job",
};

/** Number of skeleton rows to show while loading. */
export const SKELETON_ROWS = 8;
