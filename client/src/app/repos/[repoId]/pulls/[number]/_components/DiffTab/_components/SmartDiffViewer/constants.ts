import type { SmartDiffRole } from "@devdigest/shared";

export const ROLE_ORDER: SmartDiffRole[] = ["core", "wiring", "boilerplate"];

export const ROLE_LABELS: Record<SmartDiffRole, string> = {
  core: "Core",
  wiring: "Wiring",
  boilerplate: "Boilerplate",
};

export const ROLE_ICONS: Record<SmartDiffRole, string> = {
  core: "Code",
  wiring: "Settings",
  boilerplate: "File",
};

/** Boilerplate collapsed by default — reviewers rarely need to look at it. */
export const DEFAULT_COLLAPSED: Record<SmartDiffRole, boolean> = {
  core: false,
  wiring: false,
  boilerplate: true,
};

/** Core and Wiring files open by default; Boilerplate files start collapsed. */
export const FILE_DEFAULT_EXPANDED: Record<SmartDiffRole, boolean> = {
  core: true,
  wiring: true,
  boilerplate: false,
};
