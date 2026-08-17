/**
 * RiskBriefService — business logic for AI-generated PR risk briefs.
 *
 * Architecture:
 *   Routes (thin) → Service (business logic) → Repository (DB access)
 *   LLM called via container.llm(provider) using completeStructured.
 *   In-memory per-PR lock (Map<string, Promise>) prevents concurrent generation.
 *
 * Error handling:
 *   TimeoutError (60s LLM deadline) → AppError 504
 *   ExternalServiceError with 'failed schema validation' → AppError 500 (parse exhaustion)
 *   Other ExternalServiceError (network/provider) → propagates as-is (502)
 *   Zero files → AppError 422 (EC-7/GAP-1)
 *   Lock held → AppError 409 (AC-X4)
 */
import type { Container } from '../../platform/container.js';
import { AppError, ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import { TimeoutError } from '../../platform/resilience.js';
import { renderPrompt } from '../../platform/prompts.js';
import { hardenSystemPrompt, wrapUntrusted } from '@devdigest/reviewer-core';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { RiskBriefRepository } from './repository.js';
import type { Brief, BriefSources, RiskBriefResponse, RiskBriefGeneratingResponse } from '@devdigest/shared';
import { Brief as BriefSchema } from '@devdigest/shared';

/** Returned by getBrief when generation is in-flight. */
export type RiskBriefGenerating = RiskBriefGeneratingResponse;

/**
 * Module-level in-memory lock: keyed by prId, value is the generation promise.
 * Resolved/rejected promises are deleted via .finally().
 *
 * Safety-net TTL: if the underlying HTTP call hangs past withTimeout, a 75s TTL
 * timer auto-releases the lock so subsequent requests are not permanently blocked.
 */
const generationLocks = new Map<string, Promise<RiskBriefResponse>>();
const LOCK_TTL_MS = 75_000;

export class RiskBriefService {
  private repo: RiskBriefRepository;

  constructor(private container: Container) {
    this.repo = new RiskBriefRepository(container.db);
  }

  /**
   * Get the current risk brief for a PR.
   * Validates workspace ownership. Checks in-memory lock before DB query.
   * Returns RiskBriefResponse, { status: 'generating' }, or null.
   */
  async getBrief(
    workspaceId: string,
    prId: string,
  ): Promise<RiskBriefResponse | RiskBriefGenerating | null> {
    const prRow = await this.repo.getPrForWorkspace(workspaceId, prId);
    if (!prRow) throw new NotFoundError('Pull request not found');

    // If generation is in-progress, tell the client (EC-10).
    if (generationLocks.has(prId)) {
      return { status: 'generating' };
    }

    const row = await this.repo.getLatestByPrId(prId);
    if (!row) return null;

    return rowToResponse(row, prRow.headSha);
  }

  /**
   * Generate (or regenerate) the risk brief for a PR.
   * Returns the new brief or throws:
   *   - AppError(409) if generation already in-progress
   *   - AppError(422) if PR has no files (EC-7)
   *   - AppError(504) if LLM times out
   *   - AppError(500) if LLM response fails Zod parsing after 2 attempts
   *   - ExternalServiceError(502) if LLM network/provider error
   */
  async generateBrief(workspaceId: string, prId: string): Promise<RiskBriefResponse> {
    const prRow = await this.repo.getPrForWorkspace(workspaceId, prId);
    if (!prRow) throw new NotFoundError('Pull request not found');

    // Concurrent generation guard (AC-X4).
    if (generationLocks.has(prId)) {
      throw new AppError('conflict', 'Generation already in progress', 409);
    }

    const promise = this.doGenerate(workspaceId, prId, prRow).finally(() => {
      generationLocks.delete(prId);
    });
    generationLocks.set(prId, promise);

    // Safety-net TTL: release the lock if the Promise never settles.
    const ttl = setTimeout(() => generationLocks.delete(prId), LOCK_TTL_MS);
    ttl.unref();
    promise.then(() => clearTimeout(ttl), () => clearTimeout(ttl));

    return promise;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async doGenerate(
    workspaceId: string,
    prId: string,
    prRow: {
      id: string;
      headSha: string;
      additions: number;
      deletions: number;
      filesCount: number;
      body: string | null;
      repoId: string;
      repoOwner: string;
      repoName: string;
    },
  ): Promise<RiskBriefResponse> {
    const startMs = Date.now();

    // 1. Fetch PR file paths — zero-files guard (EC-7/GAP-1).
    const prFilePaths = await this.repo.getPrFilePaths(prId);
    if (prFilePaths.length === 0) {
      throw new AppError('no_files', 'PR has no files to analyze', 422);
    }

    // Build normalized PR file set for O(1) validation.
    const normalizedPrFileSet = new Set(prFilePaths.map(normalizePath));

    // 2. Gather inputs — best-effort (AC-E3).
    const [intentRow, blastSummary] = await Promise.all([
      this.repo.getIntentForPr(prId),
      this.repo.getBlastSummaryForPr(prId),
    ]);

    // Linked issue body from PR body (RF-D).
    let linkedIssueBody: string | null = null;
    const issueNumber = extractLinkedIssueNumber(prRow.body);
    if (issueNumber !== null) {
      try {
        const gh = await this.container.github();
        const issue = await gh.getIssue(
          { owner: prRow.repoOwner, name: prRow.repoName },
          issueNumber,
        );
        linkedIssueBody = issue.body ?? null;
      } catch {
        // Best-effort: GitHub adapter unavailable or call failed.
        linkedIssueBody = null;
      }
    }

    // Project context docs (RF-E) — best-effort.
    let contextDocs: Array<{ path: string; content: string }> = [];
    let contextDocCount = 0;
    try {
      // Use the first agent configured in the workspace (if any).
      const agents = await this.container.agentsRepo.list(workspaceId);
      const agent = agents[0];
      if (agent) {
        const docs = await this.container.projectContext.resolveContextForAgent(
          agent.id,
          prRow.repoId,
        );
        contextDocs = docs.map((d) => ({ path: d.path, content: d.content }));
        contextDocCount = docs.length;
      }
    } catch {
      // Best-effort: project context unavailable.
      contextDocs = [];
      contextDocCount = 0;
    }

    // 3. Build sources metadata.
    const sources: BriefSources = {
      has_intent: intentRow !== null,
      has_blast: blastSummary !== null,
      has_linked_issue: linkedIssueBody !== null,
      has_context_docs: contextDocCount > 0,
      context_doc_count: contextDocCount,
    };

    // 4. Resolve model.
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'risk_brief',
    );
    const llm = await this.container.llm(provider);

    // 5. Build system prompt.
    const rawSystem = await renderPrompt('risk-brief.system.md', {});
    const systemPrompt = hardenSystemPrompt(rawSystem);

    // 6. Build user message assembling all gathered inputs.
    const userParts: string[] = [];

    userParts.push(
      `## PR Diff Stats\n- Additions: ${prRow.additions}\n- Deletions: ${prRow.deletions}\n- Files changed: ${prRow.filesCount}`,
    );

    userParts.push(
      `## PR Files\n${wrapUntrusted('pr-files', prFilePaths.join('\n'))}`,
    );

    if (intentRow) {
      const intentText = [
        `Intent: ${intentRow.intent}`,
        intentRow.inScope.length > 0 ? `In scope:\n${intentRow.inScope.map((s) => `- ${s}`).join('\n')}` : '',
        intentRow.outOfScope.length > 0 ? `Out of scope:\n${intentRow.outOfScope.map((s) => `- ${s}`).join('\n')}` : '',
        intentRow.riskAreas.length > 0 ? `Risk areas:\n${intentRow.riskAreas.map((s) => `- ${s}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      userParts.push(`## PR Intent\n${wrapUntrusted('intent', intentText)}`);
    }

    if (blastSummary) {
      userParts.push(`## Blast Radius Summary\n${wrapUntrusted('blast-summary', blastSummary)}`);
    }

    if (linkedIssueBody) {
      userParts.push(`## Linked Issue Body\n${wrapUntrusted('linked-issue', linkedIssueBody)}`);
    }

    if (contextDocs.length > 0) {
      const docsText = contextDocs
        .map((d) => `### ${d.path}\n${wrapUntrusted(`context-doc-${d.path}`, d.content)}`)
        .join('\n\n');
      userParts.push(`## Project Context Documents\n${docsText}`);
    }

    const userMessage = userParts.join('\n\n');

    // 7. Call LLM with structured output — maxRetries: 1 means 2 parse attempts.
    let brief: Brief;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    try {
      const result = await llm.completeStructured<Brief>({
        schema: BriefSchema,
        schemaName: 'Brief',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        model,
        temperature: 0.3,
        maxTokens: 4096,
        maxRetries: 1,
        timeoutMs: 60_000,
      });
      brief = result.data;
      promptTokens = result.tokensIn ?? null;
      completionTokens = result.tokensOut ?? null;
    } catch (err) {
      // TimeoutError → 504
      if (err instanceof TimeoutError) {
        throw new AppError('llm_timeout', 'LLM call timed out', 504);
      }
      // Parse exhaustion → 500
      if (
        err instanceof ExternalServiceError &&
        err.message.includes('failed schema validation')
      ) {
        throw new AppError('parse_failure', 'LLM response failed validation after 2 attempts', 500);
      }
      // Other ExternalServiceError (network/provider) propagates as-is → 502
      throw err;
    }

    // 8. Post-validate: filter file paths against actual PR file list (AC-E5).
    let fileRefsStripped = 0;

    const validatedRisks = brief.risks.map((risk) => {
      const validatedRefs = risk.file_refs.filter((ref) => {
        const normalized = normalizePath(ref.file);
        if (normalizedPrFileSet.has(normalized)) return true;
        console.warn(
          `[risk-brief] Stripping unrecognized file ref: "${ref.file.slice(0, 200)}" (normalized: "${normalized.slice(0, 200)}")`,
        );
        fileRefsStripped++;
        return false;
      });
      return { ...risk, file_refs: validatedRefs };
    });

    const validatedReviewFocus = brief.review_focus.filter((item) => {
      const normalized = normalizePath(item.file);
      if (normalizedPrFileSet.has(normalized)) return true;
      console.warn(
        `[risk-brief] Stripping unrecognized review_focus file: "${item.file.slice(0, 200)}" (normalized: "${normalized.slice(0, 200)}")`,
      );
      fileRefsStripped++;
      return false;
    });

    const validatedBrief: Brief = {
      ...brief,
      risks: validatedRisks,
      review_focus: validatedReviewFocus,
    };

    // 9. Persist to DB.
    const savedRow = await this.repo.upsert(prId, prRow.headSha, {
      brief: validatedBrief,
      model,
      sources,
    });

    // 10. Emit structured info log.
    const latencyMs = Date.now() - startMs;
    console.info(
      JSON.stringify({
        module: 'risk-brief',
        event: 'brief_generated',
        model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        latency_ms: latencyMs,
        inputs_present: {
          has_intent: sources.has_intent,
          has_blast: sources.has_blast,
          has_linked_issue: sources.has_linked_issue,
          has_context_docs: sources.has_context_docs,
          context_doc_count: sources.context_doc_count,
        },
        file_refs_stripped: fileRefsStripped,
        pr_id: prId.slice(0, 8),
        head_sha: prRow.headSha.slice(0, 8),
      }),
    );

    return rowToResponse(savedRow, prRow.headSha);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a file path for comparison:
 * - Strip leading ./
 * - Normalize path separators to /
 * - Lowercase
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/** Extract linked issue number from PR body using closing keywords. */
function extractLinkedIssueNumber(body: string | null): number | null {
  if (!body) return null;
  const m = body.match(/(?:closes?|fixes?|resolves?)\s+#(\d+)/i);
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 10);
  return isNaN(n) ? null : n;
}

function rowToResponse(
  row: { prId: string; headSha: string; brief: Brief; model: string; sources: BriefSources | null; generated_at: string },
  _currentHeadSha: string,
): RiskBriefResponse {
  return {
    brief: row.brief,
    head_sha: row.headSha,
    sources: row.sources ?? undefined,
    model: row.model,
    generated_at: row.generated_at,
  };
}
