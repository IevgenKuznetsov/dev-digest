import { readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { ContextDocCategory, SpecReadEntry } from '@devdigest/shared';
import { ProjectContextRepository } from './repository.js';
import type { ContextDocRow } from './repository.js';
import { scanDirectory, countTokens, validateFilename, validateContent } from './scanner.js';
import { DEFAULT_GLOBS } from './helpers.js';
import type { AgentContextDocEntry } from './repository.js';
import * as schema from '../../db/schema.js';

export interface ContextDocResult {
  id: string;
  workspaceId: string;
  repoId: string;
  path: string;
  category: ContextDocCategory;
  tokens: number;
  scannedAt: Date;
  createdAt: Date;
}

export interface ResolvedContextDoc extends ContextDocResult {
  content: string;
}

/**
 * Service for the project-context module. Owns all business logic for
 * context document discovery, CRUD, attachment management, and context merge.
 */
export class ProjectContextService {
  private repo: ProjectContextRepository;

  constructor(private container: Container) {
    this.repo = new ProjectContextRepository(container.db);
  }

  // ---- Scan guard ----------------------------------------------------------

  async isScanRunning(repoId: string): Promise<boolean> {
    return this.repo.isScanRunning(repoId);
  }

  // ---- Scanning ------------------------------------------------------------

  /**
   * Scan the repo's clone directory for markdown files and upsert their metadata.
   * Returns the full list of docs for this repo after scan.
   */
  async scan(workspaceId: string, repoId: string): Promise<ContextDocRow[]> {
    const repoRow = await this.getRepoRow(repoId);
    if (!repoRow.clonePath) {
      throw new AppError('scan_error', 'Repository clone directory not available', 400);
    }

    // Verify the clone directory exists.
    try {
      await access(repoRow.clonePath);
    } catch {
      throw new AppError('scan_error', 'Repository clone directory does not exist (AC-X1)', 400);
    }

    const scanned = await scanDirectory(repoRow.clonePath, DEFAULT_GLOBS);
    const now = new Date();

    const upserted = await this.repo.upsertDocs(
      scanned.map((f) => ({
        workspaceId,
        repoId,
        path: f.path,
        category: f.category,
        tokens: f.tokens,
        scannedAt: now,
      })),
    );

    // Remove stale entries (files no longer on disk).
    await this.repo.removeStale(repoId, scanned.map((f) => f.path));

    return upserted;
  }

  // ---- Doc listing / retrieval ---------------------------------------------

  async listDocs(workspaceId: string, repoId: string, search?: string): Promise<ContextDocRow[]> {
    void workspaceId; // workspace scoping via repoId FK
    return this.repo.listByRepo(repoId, search);
  }

  async getDoc(workspaceId: string, docId: string): Promise<ContextDocRow> {
    const doc = await this.repo.getById(docId);
    if (!doc) throw new NotFoundError('Context document not found');
    if (doc.workspaceId !== workspaceId) throw new NotFoundError('Context document not found');
    return doc;
  }

  // ---- File I/O ------------------------------------------------------------

  async readContent(workspaceId: string, docId: string): Promise<string> {
    const doc = await this.getDoc(workspaceId, docId);
    const repoRow = await this.getRepoRow(doc.repoId);
    if (!repoRow.clonePath) {
      throw new AppError('file_error', 'Repository clone directory not available', 400);
    }

    const filePath = this.resolveAndValidatePath(repoRow.clonePath, doc.path);
    try {
      return await readFile(filePath, 'utf8');
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        throw new AppError(
          'file_not_found',
          'File not found on disk — run a re-scan',
          404,
        );
      }
      throw new AppError('file_error', `Failed to read file: ${(err as Error).message}`, 500);
    }
  }

  async writeContent(workspaceId: string, docId: string, content: string): Promise<ContextDocRow> {
    const validation = validateContent(content);
    if (!validation.ok) throw new ValidationError(validation.reason);

    const doc = await this.getDoc(workspaceId, docId);
    const repoRow = await this.getRepoRow(doc.repoId);
    if (!repoRow.clonePath) {
      throw new AppError('file_error', 'Repository clone directory not available', 400);
    }

    const filePath = this.resolveAndValidatePath(repoRow.clonePath, doc.path);
    try {
      await writeFile(filePath, content, 'utf8');
    } catch (err) {
      throw new AppError('file_error', `Failed to write file: ${(err as Error).message}`, 500);
    }

    const tokens = countTokens(content);
    const now = new Date();
    await this.repo.updateTokens(docId, tokens, now);

    const updated = await this.repo.getById(docId);
    return updated!;
  }

  async createDoc(
    workspaceId: string,
    repoId: string,
    directory: 'specs' | 'docs' | 'insights',
    filename: string,
    content = '',
  ): Promise<ContextDocRow> {
    const filenameValidation = validateFilename(filename);
    if (!filenameValidation.ok) throw new ValidationError(filenameValidation.reason);

    const contentValidation = validateContent(content);
    if (!contentValidation.ok) throw new ValidationError(contentValidation.reason);

    const repoRow = await this.getRepoRow(repoId);
    if (!repoRow.clonePath) {
      throw new AppError('file_error', 'Repository clone directory not available', 400);
    }

    const relativePath = `${directory}/${filename}`;
    const filePath = this.resolveAndValidatePath(repoRow.clonePath, relativePath);

    // Check the file doesn't already exist.
    try {
      await access(filePath);
      throw new ValidationError(`File already exists: ${relativePath}`);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code !== 'ENOENT') throw err;
      // ENOENT is expected — the file doesn't exist yet.
    }

    // Ensure the directory exists.
    await mkdir(dirname(filePath), { recursive: true });

    try {
      await writeFile(filePath, content, 'utf8');
    } catch (err) {
      throw new AppError('file_error', `Failed to create file: ${(err as Error).message}`, 500);
    }

    const category = this.categoryForDirectory(directory, filename);
    const tokens = countTokens(content);
    const now = new Date();

    const [doc] = await this.repo.upsertDocs([
      { workspaceId, repoId, path: relativePath, category, tokens, scannedAt: now },
    ]);
    return doc!;
  }

  async deleteDoc(workspaceId: string, docId: string): Promise<void> {
    const doc = await this.getDoc(workspaceId, docId);
    const repoRow = await this.getRepoRow(doc.repoId);

    if (repoRow.clonePath) {
      const filePath = this.resolveAndValidatePath(repoRow.clonePath, doc.path);
      try {
        await unlink(filePath);
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code !== 'ENOENT') {
          throw new AppError('file_error', `Failed to delete file: ${(err as Error).message}`, 500);
        }
        // ENOENT is fine — the file is already gone; just clean up the DB row.
      }
    }

    await this.repo.deleteById(docId);
  }

  async createFolder(
    workspaceId: string,
    repoId: string,
    directory: 'specs' | 'docs' | 'insights',
    name: string,
  ): Promise<{ path: string }> {
    void workspaceId;
    const repoRow = await this.getRepoRow(repoId);
    if (!repoRow.clonePath) {
      throw new AppError('file_error', 'Repository clone directory not available', 400);
    }

    const relativePath = `${directory}/${name}`;
    const dirPath = this.resolveAndValidatePath(repoRow.clonePath, relativePath);

    try {
      await mkdir(dirPath, { recursive: true });
    } catch (err) {
      throw new AppError('file_error', `Failed to create folder: ${(err as Error).message}`, 500);
    }

    return { path: relativePath };
  }

  // ---- Agent context attachments -------------------------------------------

  async getAgentContext(workspaceId: string, agentId: string): Promise<{
    attached: Array<ContextDocResult & { order: number }>;
    totalAvailable: number;
  }> {
    void workspaceId;
    const rows = await this.repo.getAgentDocs(agentId);
    // We need repoId to count available — get from first doc or agent row.
    // totalAvailable uses a separate count (all docs for any repo this agent touches).
    // For simplicity: count from the first doc's repoId, or 0 if no docs.
    const repoId = rows[0]?.doc.repoId;
    const totalAvailable = repoId ? await this.repo.countByRepo(repoId) : 0;

    return {
      attached: rows.map((r) => ({ ...this.toResult(r.doc), order: r.order })),
      totalAvailable,
    };
  }

  async setAgentContext(
    workspaceId: string,
    agentId: string,
    docs: AgentContextDocEntry[],
  ): Promise<void> {
    await this.repo.setAgentDocs(workspaceId, agentId, docs);
  }

  async getSkillContext(workspaceId: string, skillId: string): Promise<{
    attached: Array<ContextDocResult & { order: number }>;
  }> {
    void workspaceId;
    const rows = await this.repo.getSkillDocs(skillId);
    return {
      attached: rows.map((r) => ({ ...this.toResult(r.doc), order: r.order })),
    };
  }

  async setSkillContext(
    workspaceId: string,
    skillId: string,
    docs: AgentContextDocEntry[],
  ): Promise<void> {
    await this.repo.setSkillDocs(workspaceId, skillId, docs);
  }

  // ---- Context merge (used by run-executor) --------------------------------

  /**
   * Resolve the effective context document set for an agent at review time.
   * Implements the merge algorithm from the spec:
   *   1. Agent-level docs (ordered)
   *   2. Enabled skill docs (ordered by skill, then by doc order)
   *   3. Deduplicate by path (first occurrence wins)
   *   4. Read content from disk — skip missing files with a warning, but include
   *      them in the output with tokens=0 so the trace shows what was expected.
   */
  async resolveContextForAgent(
    agentId: string,
    repoId: string,
    onWarning?: (msg: string) => void,
  ): Promise<Array<SpecReadEntry & { content: string }>> {
    // Step 1: agent-level docs
    const agentDocs = await this.repo.getAgentDocsForMerge(agentId);

    // Step 2: enabled skills + their docs
    const enabledSkills = await this.repo.getEnabledSkillsForAgent(agentId);
    const skillDocs: ContextDocRow[] = [];
    for (const skill of enabledSkills) {
      const docs = await this.repo.getSkillDocsForMerge(skill.id);
      skillDocs.push(...docs);
    }

    // Step 3: merge + deduplicate by path (first occurrence wins)
    const all = [...agentDocs, ...skillDocs];
    const seen = new Set<string>();
    const deduped: ContextDocRow[] = [];
    for (const doc of all) {
      if (!seen.has(doc.path)) {
        seen.add(doc.path);
        deduped.push(doc);
      }
    }

    if (deduped.length === 0) return [];

    // Step 4: get the clone path for this repo
    const repoRow = await this.getRepoRow(repoId);
    if (!repoRow.clonePath) {
      onWarning?.('context merge: repository clone directory not available, skipping all context docs');
      return [];
    }

    // Step 5: read content from disk for each doc
    const results: Array<SpecReadEntry & { content: string }> = [];
    for (const doc of deduped) {
      const filePath = join(repoRow.clonePath, doc.path);
      try {
        const content = await readFile(filePath, 'utf8');
        results.push({
          path: doc.path,
          category: doc.category as ContextDocCategory,
          tokens: doc.tokens,
          content,
        });
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'ENOENT') {
          onWarning?.(`context doc missing on disk: ${doc.path}, skipping content but recording in trace`);
          // Still include the entry in specs_read (with tokens=0) so the trace
          // shows the doc was expected but unavailable.
          results.push({
            path: doc.path,
            category: doc.category as ContextDocCategory,
            tokens: 0,
            content: '',
          });
        } else {
          onWarning?.(`context doc read error: ${doc.path} — ${(err as Error).message}, skipping`);
        }
      }
    }

    return results;
  }

  // ---- Private helpers -----------------------------------------------------

  private async getRepoRow(repoId: string) {
    const [repo] = await this.container.db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.id, repoId));
    if (!repo) throw new NotFoundError('Repository not found');
    return repo;
  }

  /**
   * Resolve a relative path against the clone root and verify it stays within
   * the clone root (path traversal guard). Rejects with 400 if traversal is detected.
   */
  private resolveAndValidatePath(clonePath: string, relativePath: string): string {
    const resolved = resolve(clonePath, relativePath);
    const normalClone = resolve(clonePath);
    if (!resolved.startsWith(normalClone + '/') && resolved !== normalClone) {
      throw new AppError(
        'path_traversal',
        'Path traversal detected — access to files outside the repository is not allowed',
        400,
      );
    }
    return resolved;
  }

  private categoryForDirectory(
    directory: 'specs' | 'docs' | 'insights',
    filename: string,
  ): ContextDocCategory {
    if (filename === 'INSIGHTS.md') return 'insights';
    if (directory === 'specs') return 'specs';
    if (directory === 'docs') return 'docs';
    return 'insights';
  }

  private toResult(doc: ContextDocRow): ContextDocResult {
    return {
      id: doc.id,
      workspaceId: doc.workspaceId,
      repoId: doc.repoId,
      path: doc.path,
      category: doc.category as ContextDocCategory,
      tokens: doc.tokens,
      scannedAt: doc.scannedAt,
      createdAt: doc.createdAt,
    };
  }
}
