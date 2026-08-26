/* CiTab/constants.ts — component-scoped constants for the CI tab. */

/** Label for the installed workflow version field (AC-E8). */
export const WORKFLOW_VERSION_LABEL = "Installed workflow version";

/** Label for the CI gate setting. */
export const CI_FAIL_ON_LABEL = "Fail CI on";

/** Number of skeleton rows to show while loading run history. */
export const RUN_HISTORY_SKELETON_ROWS = 4;

/** CI fail-on level display map. */
export const CI_FAIL_ON_LABELS: Record<string, string> = {
  never: "Never block — comment only",
  critical: "Block on critical",
  warning: "Block on warning or critical",
  any: "Block on any finding",
};
