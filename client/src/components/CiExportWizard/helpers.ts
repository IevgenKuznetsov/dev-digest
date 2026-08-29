/* CiExportWizard/helpers.ts — pure helpers for the export wizard. */
import { zipSync, strToU8 } from "fflate";
import type { CiFile } from "@devdigest/shared";

/**
 * Build a zip from a list of CiFile records (AC-E5).
 * Uses fflate's zipSync + strToU8 — tree-shaken to ~4-5 kB gzipped.
 * Returns a Blob ready for download via URL.createObjectURL.
 */
export function buildZip(files: CiFile[]): Blob {
  const entries = Object.fromEntries(
    files.map((f) => [f.path, strToU8(f.contents)]),
  );
  const zipped = zipSync(entries, { level: 6 });
  return new Blob([zipped], { type: "application/zip" });
}

/**
 * Trigger a browser file download without a server round-trip.
 * Creates a temporary object URL, clicks it, and revokes it.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Extract the editable workflow YAML file from a CiFile list.
 * Returns the first editable file's contents, or an empty string.
 */
export function extractWorkflowYaml(files: CiFile[]): string {
  return files.find((f) => f.editable)?.contents ?? "";
}

/**
 * Parse a comma-separated runner label input (e.g. "self-hosted, devdigest")
 * into a label array for the export request body (AC-U9, AC-E4b).
 */
export function parseRunnerLabel(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
