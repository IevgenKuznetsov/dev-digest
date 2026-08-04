import type { Skill, SkillType, SkillSource } from '@devdigest/shared';
import type { SkillRow } from '../../db/rows.js';

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