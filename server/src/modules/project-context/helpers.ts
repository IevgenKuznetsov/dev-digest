import { z } from 'zod';

// ============================================================ Constants

export const MAX_ATTACHED_DOCS = 10;
export const MAX_FILE_SIZE = 500 * 1024; // 500 KB
export const DEFAULT_GLOBS = ['**/specs/**/*.md', '**/docs/**/*.md', '**/INSIGHTS.md'];

// ============================================================ Route param schemas

export const RepoIdParams = z.object({
  repoId: z.string().uuid(),
});
export type RepoIdParams = z.infer<typeof RepoIdParams>;

export const DocIdParams = z.object({
  repoId: z.string().uuid(),
  docId: z.string().uuid(),
});
export type DocIdParams = z.infer<typeof DocIdParams>;

export const AgentIdParams = z.object({
  agentId: z.string().uuid(),
});
export type AgentIdParams = z.infer<typeof AgentIdParams>;

export const SkillIdParams = z.object({
  skillId: z.string().uuid(),
});
export type SkillIdParams = z.infer<typeof SkillIdParams>;

// ============================================================ Request body schemas

export const CreateDocBody = z.object({
  directory: z.enum(['specs', 'docs', 'insights']),
  filename: z.string().min(1),
  content: z.string().optional(),
});
export type CreateDocBody = z.infer<typeof CreateDocBody>;

export const UpdateContentBody = z.object({
  content: z.string().max(MAX_FILE_SIZE),
});
export type UpdateContentBody = z.infer<typeof UpdateContentBody>;

export const CreateFolderBody = z.object({
  directory: z.enum(['specs', 'docs', 'insights']),
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Folder name may only contain letters, numbers, hyphens, and underscores'),
});
export type CreateFolderBody = z.infer<typeof CreateFolderBody>;

/** Entry in the ordered set for PUT /agents/:id/context and /skills/:id/context */
export const ContextDocEntry = z.object({
  contextDocId: z.string().uuid(),
  order: z.number().int().nonnegative(),
});
export type ContextDocEntry = z.infer<typeof ContextDocEntry>;

export const SetContextBody = z.object({
  docs: z.array(ContextDocEntry).max(MAX_ATTACHED_DOCS),
});
export type SetContextBody = z.infer<typeof SetContextBody>;

export const ListDocsQuery = z.object({
  search: z.string().optional(),
});
export type ListDocsQuery = z.infer<typeof ListDocsQuery>;

// ============================================================ Repo-scan helpers

/** Default glob patterns for the "search repository" feature. */
export const DEFAULT_SCAN_PATTERNS = '**/*.md';

/**
 * Convert user-facing comma-separated patterns (e.g. "*spec.md") into
 * fast-glob patterns ("**\/*spec.md"). Patterns that already contain a "/"
 * are left as-is so users can express directory-scoped matches.
 */
export function parseUserPatterns(raw: string): string[] {
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (p.includes('/') ? p : `**/${p}`));
}

export const FindByPatternsQuery = z.object({
  /** Comma-separated user patterns, defaults to DEFAULT_SCAN_PATTERNS server-side. */
  patterns: z.string().optional(),
});
export type FindByPatternsQuery = z.infer<typeof FindByPatternsQuery>;

export const ImportFilesBody = z.object({
  /** Relative paths (from repo root) of files to import into the context DB. */
  paths: z.array(z.string()).min(1).max(100),
});
export type ImportFilesBody = z.infer<typeof ImportFilesBody>;
