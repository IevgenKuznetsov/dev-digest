/* CiExportWizard/constants.ts — wizard-scoped constants. */

/** Step labels for ExportWizardSteps. */
export const WIZARD_LABELS = ["Target", "Preview", "Configure", "Install"] as const;

/** Number of wizard steps. */
export const WIZARD_STEP_COUNT = WIZARD_LABELS.length;

/** Target CI system descriptors shown on step 1. */
export interface TargetCard {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

export const TARGET_CARDS: TargetCard[] = [
  {
    key: "gha",
    label: "GitHub Actions",
    description: "Bundle your agent into a reusable GitHub Actions workflow.",
    enabled: true,
  },
  {
    key: "circle",
    label: "CircleCI",
    description: "CircleCI support coming soon.",
    enabled: false,
  },
  {
    key: "jenkins",
    label: "Jenkins",
    description: "Jenkins support coming soon.",
    enabled: false,
  },
  {
    key: "cli",
    label: "Generic CLI",
    description: "Generic CLI support coming soon.",
    enabled: false,
  },
] as const;

/** Available PR event triggers. */
export const AVAILABLE_TRIGGERS = [
  { key: "opened", label: "Opened" },
  { key: "synchronize", label: "Synchronize" },
  { key: "reopened", label: "Reopened (optional)" },
] as const;

/** Publish mode options. */
export const PUBLISH_MODES = [
  { key: "github_review", label: "GitHub Review (request changes / approve)" },
  { key: "pr_comment", label: "PR Comment" },
  { key: "none", label: "None — upload artifact only" },
] as const;
