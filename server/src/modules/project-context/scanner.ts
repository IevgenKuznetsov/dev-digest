import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import type { ContextDocCategory } from '@devdigest/shared';
import { MAX_FILE_SIZE, DEFAULT_GLOBS } from './helpers.js';

// ============================================================ Token counting

/**
 * Simple word-based token heuristic: split on whitespace and scale by 1.3.
 * No external tokenizer — synchronous, fast enough for 500 files.
 */
export function countTokens(content: string): number {
  const words = content.split(/\s+/).filter((w) => w.length > 0);
  return Math.trunc(words.length * 1.3);
}

// ============================================================ Category classification

/**
 * Determine the category of a matched file based on the glob pattern that matched
 * it and its filename. Per AC-U4:
 *   - glob containing 'specs'   → 'specs'
 *   - glob containing 'docs'    → 'docs'
 *   - filename is 'INSIGHTS.md' → 'insights'
 *   - otherwise                 → 'other'
 */
export function categorizeFile(filePath: string, matchedGlob: string): ContextDocCategory {
  const name = basename(filePath);
  if (name === 'INSIGHTS.md') return 'insights';
  if (matchedGlob.includes('specs')) return 'specs';
  if (matchedGlob.includes('docs')) return 'docs';
  return 'other';
}

// ============================================================ Filename validation

/** Filename-only validation (no directory segments). Per AC-U6. */
export function validateFilename(name: string): { ok: true } | { ok: false; reason: string } {
  if (name.includes('..')) {
    return { ok: false, reason: 'Filename must not contain path traversal sequences (..)' };
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.\-]*\.md$/.test(name)) {
    return {
      ok: false,
      reason: 'Filename must start with an alphanumeric character, contain only alphanumeric characters, hyphens, underscores, or dots, and end with .md',
    };
  }
  return { ok: true };
}

// ============================================================ Content validation

/** Content size and encoding validation. Per AC-X4. */
export function validateContent(content: string): { ok: true } | { ok: false; reason: string } {
  const byteLen = Buffer.byteLength(content, 'utf8');
  if (byteLen > MAX_FILE_SIZE) {
    return { ok: false, reason: `File content exceeds maximum size of ${MAX_FILE_SIZE / 1024} KB` };
  }
  return { ok: true };
}

// ============================================================ Directory scanner

export interface ScannedFile {
  /** Relative path from clone root (e.g. 'specs/security-baseline.md') */
  path: string;
  category: ContextDocCategory;
  tokens: number;
  content: string;
}

/**
 * Scan a clone directory for markdown files matching the configured glob patterns.
 * Returns an array of ScannedFile with computed category and token count.
 * Uses fast-glob for reliable glob matching.
 */
export async function scanDirectory(
  clonePath: string,
  globs: string[] = DEFAULT_GLOBS,
): Promise<ScannedFile[]> {
  // Dynamic import so fast-glob doesn't affect the module load if unused.
  const { default: fg } = await import('fast-glob');

  const results: ScannedFile[] = [];

  // For each glob pattern, find matches and record which pattern matched.
  // We process patterns in order so category precedence is deterministic.
  const seen = new Set<string>();

  for (const pattern of globs) {
    const matches = await fg(pattern, {
      cwd: clonePath,
      dot: true,
      onlyFiles: true,
    });

    for (const relPath of matches) {
      if (seen.has(relPath)) continue;
      seen.add(relPath);

      const absolutePath = resolve(clonePath, relPath);
      try {
        const content = await readFile(absolutePath, 'utf8');
        const tokens = countTokens(content);
        const category = categorizeFile(relPath, pattern);
        results.push({ path: relPath, category, tokens, content });
      } catch {
        // Skip unreadable files silently — the scan continues.
      }
    }
  }

  return results;
}
