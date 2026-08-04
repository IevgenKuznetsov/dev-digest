import type { Skill, SkillType, SkillSource } from '@devdigest/shared';
import type { SkillRow } from '../../db/rows.js';
import { ValidationError } from '../../platform/errors.js';

/**
 * Map a persisted skill row to the public `Skill` DTO.
 *
 * Drizzle infers `type` and `source` as plain `string` — we cast to the Zod
 * literal unions (see server/INSIGHTS.md 2026-08-03 entry on Drizzle ↔ Zod).
 */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: (row.evidenceFiles as string[] | null) ?? null,
  };
}

/** Result of parsing a markdown body for import preview (not persisted). */
export interface ImportPreview {
  name: string;
  description: string;
  body: string;
  type: 'custom';
}

/**
 * Parse a markdown string to extract a name (first `# heading`) and description
 * (first non-empty paragraph after the heading). Used by the import-preview
 * endpoint — no persistence, no side effects.
 */
export function parseMarkdownSkill(markdown: string, nameOverride?: string): ImportPreview {
  const lines = markdown.split('\n');
  let name = nameOverride ?? '';
  let description = '';

  for (const line of lines) {
    const heading = line.match(/^#\s+(.+)/);
    if (heading && !name) {
      name = heading[1]!.trim();
      continue;
    }
    if (!description && name && line.trim().length > 0 && !line.startsWith('#')) {
      description = line.trim();
      break;
    }
  }

  if (!name) name = 'Untitled skill';

  return { name, description, body: markdown, type: 'custom' };
}

// ---- URL normalization ----

/**
 * Convert hosting-platform blob/view URLs to their raw-content equivalents so
 * `fetch()` returns the actual markdown instead of an HTML page.
 *
 *  GitHub:  github.com/:owner/:repo/blob/:ref/:path → raw.githubusercontent.com/:owner/:repo/:ref/:path
 *  GitLab:  gitlab.com/:owner/:repo/-/blob/:ref/:path → gitlab.com/:owner/:repo/-/raw/:ref/:path
 */
export function toRawUrl(input: string): string {
  try {
    const u = new URL(input);

    // GitHub blob → raw.githubusercontent.com
    const ghBlob = u.pathname.match(/^\/([^/]+\/[^/]+)\/blob\/(.+)$/);
    if (u.hostname === 'github.com' && ghBlob) {
      return `https://raw.githubusercontent.com/${ghBlob[1]}/${ghBlob[2]}`;
    }

    // GitLab blob → raw
    const glBlob = u.pathname.match(/^\/([^/]+\/[^/]+)\/-\/blob\/(.+)$/);
    if (u.hostname.includes('gitlab') && glBlob) {
      return `${u.origin}/${glBlob[1]}/-/raw/${glBlob[2]}`;
    }
  } catch {
    // not a valid URL — return as-is, let caller fail on fetch
  }
  return input;
}

// ---- Prompt-injection scanner for untrusted skill bodies ----

/**
 * Patterns that indicate prompt injection attempts in imported skill bodies.
 * These match directives that try to override the agent's role, bypass safety,
 * or exfiltrate data. Case-insensitive, tested against the full body.
 */
const INJECTION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // Role/identity hijacking
  { re: /you\s+are\s+(now|a|an)\b/i, label: 'role override' },
  { re: /\bignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|constraints?)/i, label: 'instruction override' },
  { re: /\bdisregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i, label: 'instruction override' },
  { re: /\bforget\s+(all\s+)?(previous|prior|your|above)\s+(instructions?|prompts?|rules?|context)/i, label: 'instruction override' },
  // System prompt extraction
  { re: /\b(print|output|reveal|show|repeat|echo)\s+(your|the)\s+(system\s+prompt|instructions?|rules?|system\s+message)/i, label: 'prompt extraction' },
  { re: /\bwhat\s+(are|is)\s+your\s+(system\s+prompt|instructions?|rules?|system\s+message)/i, label: 'prompt extraction' },
  // Jailbreak patterns
  { re: /\bDAN\s+mode\b/i, label: 'jailbreak (DAN)' },
  { re: /\bdeveloper\s+mode\b/i, label: 'jailbreak (developer mode)' },
  { re: /\bjailbreak\b/i, label: 'jailbreak' },
  // Data exfiltration
  { re: /\b(send|post|fetch|exfiltrate|transmit)\s+(to|data|the|all)\b.*\b(url|endpoint|webhook|server)\b/i, label: 'data exfiltration' },
  // Delimiter escape
  { re: /<\/untrusted>/i, label: 'delimiter escape' },
  { re: /<\/?system>/i, label: 'system tag injection' },
  // Direct instruction to the model
  { re: /\b(always|must|never)\s+(respond|answer|reply|output)\b.*\b(with|as|in)\b/i, label: 'behavioral override' },
  { re: /\bdo\s+not\s+(flag|report|mention|review|check|analyze)\b/i, label: 'review suppression' },
  { re: /\bskip\s+(all\s+)?(security|review|check|validation|analysis)/i, label: 'review suppression' },
];

/**
 * Scan a skill body for prompt-injection patterns. Throws ValidationError if
 * any match is found. Called on untrusted imports (file, URL) — community
 * catalog and manual creation are trusted paths.
 */
export function assertNoInjection(body: string): void {
  for (const { re, label } of INJECTION_PATTERNS) {
    if (re.test(body)) {
      throw new ValidationError(
        `Skill body blocked: detected "${label}" pattern. ` +
        'Imported skill bodies are treated as untrusted data and must not contain ' +
        'directives that attempt to override agent behavior, extract prompts, or suppress reviews.',
      );
    }
  }
}