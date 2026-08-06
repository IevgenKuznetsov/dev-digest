/**
 * Hunk header extraction helper.
 *
 * Parses a raw unified diff and extracts the text after `@@` markers
 * (function/class context that git diff includes by default).
 *
 * Example diff line:
 *   @@ -23,7 +23,7 @@ function rateLimit() {
 *                           ^^^^^^^^^^^^^^^^^^^^
 *                           this text is the hunk header
 *
 * Returns a Map of filePath → string[] of header texts (may be empty strings
 * when git did not capture a context name for the hunk).
 */
export function extractHunkHeaders(raw: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let currentFile: string | null = null;

  for (const line of raw.split('\n')) {
    // Track current file from diff header lines ("diff --git a/... b/...")
    const fileMatch = line.match(/^diff --git a\/(.+) b\//);
    if (fileMatch?.[1]) {
      currentFile = fileMatch[1];
      if (!result.has(currentFile)) {
        result.set(currentFile, []);
      }
      continue;
    }

    // Also pick up "--- a/..." lines as a fallback when no diff --git header
    if (!currentFile) {
      const aMatch = line.match(/^--- a\/(.+)/);
      if (aMatch?.[1]) {
        currentFile = aMatch[1];
        if (!result.has(currentFile)) {
          result.set(currentFile, []);
        }
        continue;
      }
    }

    // Extract the hunk header text after `@@`
    // Pattern: @@ -old,count +new,count @@ optional header text
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@\s*(.*?)$/);
    if (hunkMatch?.[1] !== undefined && currentFile) {
      const header = hunkMatch[1].trim();
      if (header.length > 0) {
        const existing = result.get(currentFile);
        if (existing) {
          existing.push(header);
        } else {
          result.set(currentFile, [header]);
        }
      }
    }
  }

  return result;
}

/**
 * Flatten the hunk headers map to a de-duplicated string array of
 * "function/class name" texts, capped at `limit` items.
 */
export function flattenHunkHeaders(headers: Map<string, string[]>, limit = 50): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const texts of headers.values()) {
    for (const text of texts) {
      if (!seen.has(text) && result.length < limit) {
        seen.add(text);
        result.push(text);
      }
    }
  }
  return result;
}
