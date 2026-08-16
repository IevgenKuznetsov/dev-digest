/**
 * OnboardingService — core business logic for onboarding tour generation.
 *
 * Architecture:
 *   - Routes (thin) → Service (business logic) → Repository (DB access)
 *   - LLM called via container.llm(provider) using completeStructured
 *   - In-memory per-repo lock (Map<string, Promise>) prevents concurrent generation
 *
 * Error handling (AC-X1, AC-X5, AC-X7):
 *   - TimeoutError (60s LLM deadline) → AppError 504
 *   - ExternalServiceError with 'failed schema validation' → AppError 500 (parse exhaustion)
 *   - Other ExternalServiceError (network/provider) → propagates as-is (502)
 *
 * Note: In-memory lock is lost on server restart. The client's next GET returns
 * 404 (empty state) and the user can retry. Acceptable for v1 per spec open questions.
 */
import { readFile } from 'node:fs/promises';
import type { Container } from '../../platform/container.js';
import { AppError, ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import { resolveAndValidatePath } from '../../platform/paths.js';
import { TimeoutError } from '../../platform/resilience.js';
import { renderPrompt } from '../../platform/prompts.js';
import { hardenSystemPrompt, wrapUntrusted } from '@devdigest/reviewer-core';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { walkClone } from '../repo-intel/pipeline/walk.js';
import { OnboardingRepository } from './repository.js';
import type { OnboardingRow } from './repository.js';
import type { StrictOnboardingOutput, OnboardingSectionKind } from '@devdigest/shared';
import { StrictOnboardingOutput as StrictOnboardingOutputSchema } from '@devdigest/shared';
import type { OnboardingSection } from '@devdigest/shared';

const CONFIG_FILES = ['package.json', 'Makefile', 'docker-compose.yml', 'README.md'];
const TOP_FILES_COUNT = 15;
const TOP_FILE_LINES = 100;

/** Exported response DTO shape. */
export interface OnboardingResult {
  sections: OnboardingSection[];
  model: string;
  generated_at: string;
  input_sha: string | null;
}

/** Returned by getOnboarding when a generation is currently in-flight. */
export interface OnboardingGenerating {
  status: 'generating';
}

/**
 * Module-level in-memory lock: keyed by repoId, value is the generation promise.
 * Resolved/rejected promises are deleted via .finally().
 */
const generationLocks = new Map<string, Promise<OnboardingResult>>();

export class OnboardingService {
  private repo: OnboardingRepository;

  constructor(private container: Container) {
    this.repo = new OnboardingRepository(container.db);
  }

  /**
   * Get the current onboarding tour for a repo.
   * Validates workspace ownership. Checks in-memory lock before DB query.
   * Returns OnboardingResult, OnboardingGenerating, or null (caller maps to 404).
   */
  async getOnboarding(
    workspaceId: string,
    repoId: string,
  ): Promise<OnboardingResult | OnboardingGenerating | null> {
    await this.validateWorkspace(workspaceId, repoId);

    // If generation is in-progress, tell the client (AC-S1).
    if (generationLocks.has(repoId)) {
      return { status: 'generating' };
    }

    const row = await this.repo.getByRepoId(repoId);
    if (!row) return null;
    return rowToDto(row);
  }

  /**
   * Generate (or regenerate) the onboarding tour for a repo.
   * Returns the new result or throws:
   *   - AppError(409) if generation already in-progress (AC-X2)
   *   - AppError(504) if LLM times out (AC-X5)
   *   - AppError(500) if LLM response fails Zod parsing after 2 attempts (AC-X1)
   *   - ExternalServiceError(502) if LLM network/provider error (AC-X7)
   */
  async generateOnboarding(
    workspaceId: string,
    repoId: string,
    language: string,
  ): Promise<OnboardingResult> {
    const repoRow = await this.validateWorkspace(workspaceId, repoId);

    // Concurrent generation guard (AC-X2).
    if (generationLocks.has(repoId)) {
      throw new AppError('conflict', 'Generation already in progress', 409);
    }

    const promise = this.doGenerate(workspaceId, repoId, repoRow, language).finally(() => {
      generationLocks.delete(repoId);
    });
    generationLocks.set(repoId, promise);

    return promise;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async validateWorkspace(workspaceId: string, repoId: string) {
    const repoRow = await this.repo.getRepoForWorkspace(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repository not found in workspace');
    return repoRow;
  }

  private async doGenerate(
    workspaceId: string,
    repoId: string,
    repoRow: { owner: string; name: string; clonePath: string | null },
    language: string,
  ): Promise<OnboardingResult> {
    // 1. Gather LLM input data (AC-E3).
    const { userMessage, inputSha } = await this.gatherLlmInput(repoId, repoRow.clonePath);

    // 2. Resolve model (AC-E8).
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');
    const llm = await this.container.llm(provider);

    // 3. Build system prompt.
    const rawSystem = await renderPrompt('onboarding.system.md', { language });
    const systemPrompt = hardenSystemPrompt(rawSystem);

    // 4. Call LLM with structured output — maxRetries: 1 means 2 parse attempts (AC-X1).
    let parsed: StrictOnboardingOutput;
    try {
      const result = await llm.completeStructured<StrictOnboardingOutput>({
        schema: StrictOnboardingOutputSchema,
        schemaName: 'StrictOnboardingOutput',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        model,
        temperature: 0.3,
        maxTokens: 8192,
        maxRetries: 1,
        timeoutMs: 60_000,
      });
      parsed = result.data;
    } catch (err) {
      // TimeoutError → 504 (AC-X5)
      if (err instanceof TimeoutError) {
        throw new AppError('llm_timeout', 'LLM call timed out', 504);
      }
      // Parse exhaustion → 500 (AC-X1); network/provider ExternalServiceError → 502 (AC-X7)
      if (
        err instanceof ExternalServiceError &&
        err.message.includes('failed schema validation')
      ) {
        throw new AppError(
          'parse_failure',
          'LLM response failed validation after 2 attempts',
          500,
        );
      }
      // Other ExternalServiceError (network/provider) propagates as-is → 502
      throw err;
    }

    // 5. Post-parse normalization: enforce diagram = null for non-architecture sections (AC-U4).
    const normalizedSections: OnboardingSection[] = parsed.sections.map((s) => ({
      ...s,
      diagram: s.kind === 'architecture' ? (s.diagram ?? null) : null,
    }));

    // 6. Upsert result (upsert is AFTER completeStructured, so no DB write on error paths).
    const row = await this.repo.upsert(repoId, {
      json: { sections: normalizedSections },
      model,
      inputSha,
    });

    return rowToDto(row);
  }

  /**
   * Gather all LLM input data for onboarding generation.
   * Degrades gracefully when repo-intel index is not available (AC-X3, AC-X4).
   */
  private async gatherLlmInput(
    repoId: string,
    clonePath: string | null,
  ): Promise<{ userMessage: string; inputSha: string | null }> {
    const sections: string[] = [];
    let inputSha: string | null = null;

    // Check index state to decide whether to use full or fallback data.
    const indexState = await this.container.repoIntel.getIndexState(repoId);

    const indexUnavailable =
      indexState.status === 'degraded' ||
      indexState.status === 'failed' ||
      indexState.degraded === true ||
      !indexState.lastIndexedSha;

    if (indexUnavailable) {
      // Fallback path (AC-X3): use file tree from walk + root config files.
      this.container.config; // access config for log context
      console.warn(
        `[onboarding] Repo-intel index not available for repo ${repoId}` +
          ` (status: ${indexState.status}, reason: ${indexState.degradedReason ?? 'unknown'});` +
          ` using fallback data`,
      );

      if (clonePath) {
        const walkResult = await walkClone(clonePath);
        sections.push(
          `## File tree (fallback walk)\n${wrapUntrusted('file-tree', walkResult.files.join('\n'))}`,
        );

        // Read available config files.
        const configContents = await this.readConfigFiles(clonePath);
        if (configContents.length > 0) {
          sections.push(`## Config files\n${configContents.join('\n\n')}`);
        }
      } else {
        sections.push('## File tree\n(Repository not yet cloned — no file data available)');
      }
    } else {
      // Full path: use repo-intel data.
      inputSha = indexState.lastIndexedSha || null;

      // Repo map.
      const repoMapResult = await this.container.repoIntel.getRepoMap(repoId);
      if (repoMapResult.text) {
        sections.push(
          `## Repo map\n${wrapUntrusted('repo-map', repoMapResult.text)}`,
        );
      }

      // Top-15 files by PageRank with first 100 lines each.
      const topFiles = await this.container.repoIntel.getTopFilesByRank(repoId, TOP_FILES_COUNT);
      if (topFiles.length > 0 && clonePath) {
        const fileContents = await this.readTopFiles(clonePath, topFiles);
        if (fileContents.length > 0) {
          sections.push(`## Key files (top by PageRank)\n${fileContents.join('\n\n')}`);
        }
      }

      // Critical paths (AC-X4: empty array is OK — log warning, continue).
      const criticalPaths = await this.container.repoIntel.getCriticalPaths(repoId);
      if (criticalPaths.length === 0) {
        console.warn(
          `[onboarding] getCriticalPaths() returned [] for repo ${repoId};` +
            ` LLM will synthesize from available data`,
        );
      } else {
        const pathStrings = criticalPaths.map((p) => p.join(' → ')).join('\n');
        sections.push(`## Critical paths\n${wrapUntrusted('critical-paths', pathStrings)}`);
      }

      // File facts (endpoints/crons) via OnboardingRepository (not on RepoIntel facade).
      if (topFiles.length > 0) {
        const facts = await this.repo.getFileFacts(repoId, topFiles);
        if (facts.length > 0) {
          const factsText = facts
            .filter((f) => f.endpoints.length > 0 || f.crons.length > 0)
            .map((f) => {
              const parts: string[] = [`**${f.filePath}**`];
              if (f.endpoints.length > 0) parts.push(`  endpoints: ${f.endpoints.join(', ')}`);
              if (f.crons.length > 0) parts.push(`  crons: ${f.crons.join(', ')}`);
              return parts.join('\n');
            })
            .join('\n\n');
          if (factsText) {
            sections.push(`## File facts\n${wrapUntrusted('file-facts', factsText)}`);
          }
        }
      }

      // Config files for run_locally section.
      if (clonePath) {
        const configContents = await this.readConfigFiles(clonePath);
        if (configContents.length > 0) {
          sections.push(`## Config files\n${configContents.join('\n\n')}`);
        }
      }
    }

    const userMessage = sections.join('\n\n');
    return { userMessage, inputSha };
  }

  /** Read root config files from clone, skipping missing ones (edge case 7). */
  private async readConfigFiles(clonePath: string): Promise<string[]> {
    const results: string[] = [];
    for (const fileName of CONFIG_FILES) {
      try {
        const filePath = resolveAndValidatePath(clonePath, fileName);
        const content = await readFile(filePath, 'utf8');
        results.push(
          `### ${fileName}\n${wrapUntrusted(`config-${fileName}`, content)}`,
        );
      } catch {
        // File does not exist or path traversal detected — skip silently.
      }
    }
    return results;
  }

  /** Read first 100 lines of each top file from clone (bounded for prompt size). */
  private async readTopFiles(clonePath: string, files: string[]): Promise<string[]> {
    const results: string[] = [];
    for (const relPath of files) {
      try {
        const absPath = resolveAndValidatePath(clonePath, relPath);
        const content = await readFile(absPath, 'utf8');
        const lines = content.split('\n').slice(0, TOP_FILE_LINES).join('\n');
        results.push(
          `### ${relPath}\n${wrapUntrusted(`file-${relPath}`, lines)}`,
        );
      } catch {
        // File unreadable or path traversal detected — skip silently.
      }
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToDto(row: OnboardingRow): OnboardingResult {
  const json = row.json as { sections: OnboardingSection[] };
  return {
    sections: json.sections,
    model: row.model,
    generated_at: row.generatedAt.toISOString(),
    input_sha: row.inputSha,
  };
}
