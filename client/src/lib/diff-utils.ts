/**
 * Diff utilities — pure helpers for working with unified diff patches.
 */

const HUNK_HEADER_RE = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface ParsedHunk {
  header: string;
  body: string;
  newStart: number;
  newLines: number;
}

function parseHunks(hunkSections: string[]): ParsedHunk[] {
  return hunkSections.map((section) => {
    const firstNewline = section.indexOf('\n');
    const headerLine = firstNewline === -1 ? section : section.slice(0, firstNewline);
    const body = firstNewline === -1 ? '' : section.slice(firstNewline + 1);
    const m = HUNK_HEADER_RE.exec(headerLine);
    if (!m) {
      return { header: headerLine, body, newStart: 0, newLines: 0 };
    }
    const newStart = parseInt(m[3]!, 10);
    const newLines = m[4] !== undefined ? parseInt(m[4], 10) : 1;
    return { header: headerLine, body, newStart, newLines };
  });
}

/**
 * Extract only the hunk(s) from a unified diff patch that overlap the given
 * line range [startLine, endLine] on the new-file side.
 *
 * - Preserves the `diff --git`, `---`, `+++` header lines.
 * - Falls back to the full patch when no hunks match (e.g. unusual format).
 */
export function extractRelevantHunks(
  patch: string,
  startLine: number,
  endLine: number,
): string {
  // Split into header (before first @@) and hunk sections (starting with @@)
  const firstHunkIdx = patch.indexOf('\n@@');
  const atStart = patch.startsWith('@@');

  // No hunk headers at all — return full patch
  if (!atStart && firstHunkIdx === -1) {
    return patch;
  }

  let header: string;
  let hunkBlock: string;

  if (atStart) {
    header = '';
    hunkBlock = patch;
  } else {
    // +1 to skip the leading \n so hunkBlock starts with @@
    header = patch.slice(0, firstHunkIdx);
    hunkBlock = patch.slice(firstHunkIdx + 1);
  }

  // Split hunk block into individual hunk sections
  // Each section begins with @@ and ends before the next @@ or end of string
  const hunkSections: string[] = [];
  let remaining = hunkBlock;
  while (remaining.length > 0) {
    const nextHunk = remaining.indexOf('\n@@', 1);
    if (nextHunk === -1) {
      hunkSections.push(remaining);
      break;
    }
    hunkSections.push(remaining.slice(0, nextHunk));
    remaining = remaining.slice(nextHunk + 1); // skip the \n, keep @@
  }

  if (hunkSections.length === 0) {
    return patch;
  }

  const parsed = parseHunks(hunkSections);

  const overlapping = parsed.filter((h) => {
    const hunkEnd = h.newStart + h.newLines - 1;
    return h.newStart <= endLine && hunkEnd >= startLine;
  });

  if (overlapping.length === 0) {
    return patch;
  }

  const hunkText = overlapping
    .map((h) => (h.body ? `${h.header}\n${h.body}` : h.header))
    .join('\n');

  return header ? `${header}\n${hunkText}` : hunkText;
}

/**
 * Wrap a raw patch (hunk-only text from GitHub API) with standard unified diff
 * file headers so that parseDiffToUnifiedDiff can extract the file path.
 *
 * If the patch already contains a `diff --git` header, returns it unchanged.
 */
export function wrapPatchWithDiffHeader(filePath: string, patch: string): string {
  if (patch.startsWith('diff --git ')) return patch;
  return `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n${patch}`;
}
