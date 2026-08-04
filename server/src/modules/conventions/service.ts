import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Container } from '../../platform/container.js';
import type { ConventionCandidate, Skill } from '@devdigest/shared';
import type { ChatMessage } from '@devdigest/shared';
import { NotFoundError, ValidationError, ExternalServiceError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { ConventionsRepository } from './repository.js';
import { SkillsService } from '../skills/service.js';
import {
  ConventionExtraction,
  collectConfigFiles,
  readSampleFile,
  verifyEvidence,
  toConventionDto,
  buildSkillBody,
  MAX_SAMPLE_BYTES,
  type FileSample,
} from './helpers.js';
import * as t from '../../db/schema.js';
import { eq } from 'drizzle-orm';

const SYSTEM_PROMPT = `You are a senior code reviewer analyzing a repository to extract coding conventions.
A convention is a consistent pattern, rule, or practice observed across the codebase.
Focus on patterns that are ACTUALLY FOLLOWED in the code, not aspirational rules.

Categories to look for:
- Naming: variable, function, file, component naming patterns
- Structure: file organization, module boundaries, import patterns
- Error Handling: try/catch patterns, error types, error propagation
- Testing: test file location, naming, patterns, assertion style
- Typing: TypeScript strictness, type vs interface usage, generics patterns
- Formatting: code style beyond what formatters enforce
- API Design: route structure, request/response patterns, validation
- State Management: how state is managed
- Dependencies: how dependencies are injected, managed, imported

Only report conventions you can back with concrete evidence from the provided files.
Each convention must cite a specific file and a short code snippet (1-5 lines) as evidence.
Rate confidence from 0.0 to 1.0 based on how consistently the pattern appears across files.`;

/** Number of top-ranked source files to sample via repoIntel. */
const SAMPLE_COUNT = 12;

/** Minimum number of files needed to run extraction. */
const MIN_FILES = 2;

export class ConventionsService {
  private repo: ConventionsRepository;
  private skills: SkillsService;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.skills = new SkillsService(container);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  async updateAccepted(
    workspaceId: string,
    id: string,
    accepted: boolean,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.updateAccepted(workspaceId, id, accepted);
    return row ? toConventionDto(row) : undefined;
  }

  async batchUpdateAccepted(
    workspaceId: string,
    ids: string[],
    accepted: boolean,
  ): Promise<number> {
    return this.repo.batchUpdateAccepted(workspaceId, ids, accepted);
  }

  async clearForRepo(workspaceId: string, repoId: string): Promise<number> {
    return this.repo.deleteByRepo(workspaceId, repoId);
  }

  /**
   * Main extraction pipeline:
   * 1. Collect config files + top source files (pure code, no model)
   * 2. Call cheap LLM to extract convention candidates
   * 3. Verify evidence in the clone
   * 4. Persist validated candidates
   */
  async extract(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionCandidate[]> {
    // 1. Look up repo and validate clone.
    const repo = await this.getRepoRow(workspaceId, repoId);
    if (!repo.clonePath) {
      throw new ValidationError('Repository has not been cloned yet');
    }
    try {
      await access(repo.clonePath);
    } catch {
      throw new ValidationError('Clone directory not found on disk');
    }
    const clonePath = repo.clonePath;

    // 2. Collect samples in parallel.
    const [configFiles, samplePaths] = await Promise.all([
      collectConfigFiles(clonePath),
      this.container.repoIntel.getConventionSamples(repoId, SAMPLE_COUNT),
    ]);

    // 3. Read source file contents.
    const sourceFiles: FileSample[] = [];
    for (const path of samplePaths) {
      const sample = await readSampleFile(clonePath, path);
      if (sample) sourceFiles.push(sample);
    }

    const allFiles = [...configFiles, ...sourceFiles];
    if (allFiles.length < MIN_FILES) {
      throw new ValidationError(
        'Not enough source files to extract conventions. Ensure the repository is indexed.',
      );
    }

    // 4. Resolve LLM.
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'conventions',
    );
    const llm = await this.container.llm(provider);

    // 5. Build prompt.
    const userMessage = this.buildUserMessage(configFiles, sourceFiles);
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ];

    // 6. Call LLM.
    let extraction: ConventionExtraction;
    try {
      const result = await llm.completeStructured<ConventionExtraction>({
        schema: ConventionExtraction,
        schemaName: 'ConventionExtraction',
        messages,
        model,
        temperature: 0.2,
        maxTokens: 4096,
      });
      extraction = result.data;
    } catch (err) {
      throw new ExternalServiceError(
        `Convention extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 7. Verify evidence.
    const verified = [];
    for (const candidate of extraction.conventions) {
      const v = await verifyEvidence(clonePath, candidate);
      if (v) verified.push(v);
    }

    // 8. Clear old conventions and persist new ones.
    await this.repo.deleteByRepo(workspaceId, repoId);

    if (verified.length === 0) return [];

    const rows = await this.repo.insertBatch(
      verified.map((c) => ({
        workspaceId,
        repoId,
        rule: `[${c.category}] ${c.rule}`,
        evidencePath: c.evidence.line
          ? `${c.evidence.file}:${c.evidence.line}`
          : c.evidence.file,
        evidenceSnippet: c.evidence.snippet || null,
        confidence: c.confidence,
        accepted: false,
      })),
    );

    return rows.map(toConventionDto);
  }

  /**
   * Create a skill from accepted conventions for a repo.
   */
  async createSkillFromConventions(
    workspaceId: string,
    repoId: string,
    name: string,
    description: string,
  ): Promise<Skill> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    const accepted = rows.filter((r) => r.accepted);
    if (accepted.length === 0) {
      throw new ValidationError('No accepted conventions to create a skill from');
    }

    const repo = await this.getRepoRow(workspaceId, repoId);
    const repoName = repo.fullName ?? repo.name;
    const dtos = accepted.map(toConventionDto);
    const body = buildSkillBody(repoName, dtos);

    return this.skills.create(workspaceId, {
      name,
      description,
      type: 'convention',
      source: 'extracted',
      body,
      enabled: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getRepoRow(workspaceId: string, repoId: string) {
    const [row] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    if (!row || row.workspaceId !== workspaceId) {
      throw new NotFoundError('Repository not found');
    }
    return row;
  }

  private buildUserMessage(
    configFiles: FileSample[],
    sourceFiles: FileSample[],
  ): string {
    const parts: string[] = [
      'Analyze these repository files and extract coding conventions.',
      '',
    ];

    if (configFiles.length > 0) {
      parts.push('## Config Files');
      for (const f of configFiles) {
        parts.push(`### ${f.path}`);
        parts.push('```');
        parts.push(f.content);
        parts.push('```');
        parts.push('');
      }
    }

    if (sourceFiles.length > 0) {
      parts.push('## Source Files');
      for (const f of sourceFiles) {
        parts.push(`### ${f.path}`);
        parts.push('```');
        parts.push(f.content);
        parts.push('```');
        parts.push('');
      }
    }

    parts.push(
      'Extract 8-20 conventions that are consistently followed across the codebase.',
      'For each, cite the specific file and a short code snippet (1-5 lines) as evidence.',
      'Rate confidence from 0.0 to 1.0 based on how consistently the pattern appears.',
    );

    return parts.join('\n');
  }
}
