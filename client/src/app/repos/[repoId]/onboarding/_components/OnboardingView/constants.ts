/** Section display names keyed by kind — runtime source for section headings. */
export const SECTION_TITLES: Record<string, string> = {
  architecture: "Architecture Overview",
  critical_paths: "Critical Paths",
  run_locally: "How to Run Locally",
  reading_path: "Guided Reading Path",
  first_tasks: "First Tasks",
} as const;

/**
 * Time-based progress phases shown below the spinner during generation.
 * Each entry: [afterMs, label]. The last matching threshold wins.
 * Total LLM budget is ~60s; phases are calibrated to the actual server steps.
 */
export const GENERATION_PHASES: Array<{ afterMs: number; label: string }> = [
  { afterMs: 0,     label: "Analyzing repository structure\u2026" },
  { afterMs: 6_000, label: "Reading key files\u2026" },
  { afterMs: 18_000, label: "Identifying critical paths\u2026" },
  { afterMs: 32_000, label: "Generating tour sections\u2026" },
  { afterMs: 52_000, label: "Finalizing\u2026" },
];
