import { z } from 'zod';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConventionCandidate } from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';

// ---------------------------------------------------------------------------
// LLM response schemas (internal — not in vendor/shared/)
// ---------------------------------------------------------------------------

export const ConventionEvidence = z.object({
  file: z.string(),
  snippet: z.string(),
  line: z.number().int().optional(),
});
export type ConventionEvidence = z.infer<typeof ConventionEvidence>;

export const RawCandidate = z.object({
  category: z.string(),
  rule: z.string(),
  evidence: ConventionEvidence,
  confidence: z.number().min(0).max(1),
});
export type RawCandidate = z.infer<typeof RawCandidate>;

export const ConventionExtraction = z.object({
  conventions: z.array(RawCandidate).min(1).max(30),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

// ---------------------------------------------------------------------------
// Config file collection
// ---------------------------------------------------------------------------

/** Well-known config file names to look for in the repo root. */
const CONFIG_FILES = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.cjs',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',
  '.prettierrc.yml',
  'prettier.config.js',
  'tsconfig.json',
  '.editorconfig',
  'biome.json',
  'biome.jsonc',
  'package.json',
] as const;

/** Max bytes to read per config file. */
const MAX_CONFIG_BYTES = 4096;

/** Max bytes to read per source sample file. */
export const MAX_SAMPLE_BYTES = 8192;

export interface FileSample {
  path: string;
  content: string;
}

/**
 * Read well-known config files from the repo root. Missing files are silently
 * skipped. Content is truncated at MAX_CONFIG_BYTES to control token usage.
 */
export async function collectConfigFiles(clonePath: string): Promise<FileSample[]> {
  const results: FileSample[] = [];
  for (const name of CONFIG_FILES) {
    try {
      let content = await readFile(join(clonePath, name), 'utf8');
      if (content.length > MAX_CONFIG_BYTES) content = content.slice(0, MAX_CONFIG_BYTES);
      results.push({ path: name, content });
    } catch {
      // missing file — expected
    }
  }
  return results;
}

/**
 * Read source file content from the clone, capped at MAX_SAMPLE_BYTES.
 * Returns null if the file cannot be read.
 */
export async function readSampleFile(
  clonePath: string,
  relativePath: string,
): Promise<FileSample | null> {
  try {
    let content = await readFile(join(clonePath, relativePath), 'utf8');
    if (content.length > MAX_SAMPLE_BYTES) content = content.slice(0, MAX_SAMPLE_BYTES);
    return { path: relativePath, content };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Evidence verification
// ---------------------------------------------------------------------------

export interface VerifiedCandidate {
  category: string;
  rule: string;
  evidence: { file: string; snippet: string; line?: number };
  confidence: number;
}

/**
 * Verify that a candidate's evidence actually exists in the clone.
 * - File must exist, otherwise the candidate is dropped (returns null).
 * - Snippet is fuzzy-matched within ±5 lines of the cited line. If the exact
 *   line is wrong but snippet exists elsewhere, the line is corrected.
 * - If snippet is not found anywhere, it is cleared and confidence reduced.
 */
export async function verifyEvidence(
  clonePath: string,
  candidate: RawCandidate,
): Promise<VerifiedCandidate | null> {
  const filePath = join(clonePath, candidate.evidence.file);

  // Hard gate: file must exist.
  try {
    await access(filePath);
  } catch {
    return null;
  }

  let fileContent: string;
  try {
    fileContent = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  const lines = fileContent.split('\n');
  const snippetNorm = candidate.evidence.snippet.trim();

  // Try to locate the snippet in the file.
  const citedLine = candidate.evidence.line;
  let foundLine: number | undefined;

  if (snippetNorm.length > 0) {
    // Check near the cited line first (±5 lines window).
    if (citedLine != null && citedLine > 0) {
      const start = Math.max(0, citedLine - 6);
      const end = Math.min(lines.length, citedLine + 5);
      for (let i = start; i < end; i++) {
        if (lines[i]!.includes(snippetNorm.split('\n')[0]!)) {
          foundLine = i + 1; // 1-based
          break;
        }
      }
    }

    // Fallback: search the entire file.
    if (foundLine == null) {
      const firstSnippetLine = snippetNorm.split('\n')[0]!;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes(firstSnippetLine)) {
          foundLine = i + 1;
          break;
        }
      }
    }
  }

  // Build the verified result.
  if (foundLine != null) {
    return {
      category: candidate.category,
      rule: candidate.rule,
      evidence: {
        file: candidate.evidence.file,
        snippet: candidate.evidence.snippet,
        line: foundLine,
      },
      confidence: candidate.confidence,
    };
  }

  // Snippet not found — keep the candidate but penalize confidence.
  return {
    category: candidate.category,
    rule: candidate.rule,
    evidence: {
      file: candidate.evidence.file,
      snippet: '',
      line: undefined,
    },
    confidence: Math.max(0, candidate.confidence - 0.2),
  };
}

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    accepted: row.accepted,
  };
}

// ---------------------------------------------------------------------------
// Skill body generation
// ---------------------------------------------------------------------------

/**
 * Parse the `[Category]` prefix from a rule string.
 * Returns `{ category, ruleText }`.
 */
function parseCategory(rule: string): { category: string; ruleText: string } {
  const match = rule.match(/^\[([^\]]+)\]\s*(.*)/s);
  if (match) return { category: match[1]!, ruleText: match[2]! };
  return { category: 'General', ruleText: rule };
}

/**
 * Build a markdown skill body from accepted conventions, grouped by category.
 * Format matches the design mockup (design2.png).
 */
export function buildSkillBody(
  repoName: string,
  conventions: ConventionCandidate[],
): string {
  // Group by category.
  const groups = new Map<string, Array<{ rule: string; path: string; snippet: string }>>();
  for (const c of conventions) {
    const { category, ruleText } = parseCategory(c.rule);
    let group = groups.get(category);
    if (!group) {
      group = [];
      groups.set(category, group);
    }
    group.push({
      rule: ruleText,
      path: c.evidence_path,
      snippet: c.evidence_snippet,
    });
  }

  const lines: string[] = [
    `# ${repoName}-conventions`,
    '',
    `House conventions for '${repoName}'. Flag changes that violate any rule below and cite the offending 'file:line'.`,
    '',
  ];

  for (const [category, rules] of groups) {
    lines.push(`## ${category}`);
    for (const r of rules) {
      lines.push(`- ${r.rule}`);
      if (r.path) {
        lines.push(`  Detected in '${r.path}':`);
      }
      if (r.snippet) {
        lines.push('  ```');
        lines.push(`  ${r.snippet}`);
        lines.push('  ```');
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}
