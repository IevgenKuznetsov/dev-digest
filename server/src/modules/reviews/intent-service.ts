import path from 'node:path';
import type { Container } from '../../platform/container.js';
import type { RunLogger } from '../../platform/run-logger.js';
import type { EnrichedIntent, UnifiedDiff, GitClient, RepoRef } from '@devdigest/shared';
import { IntentClassification } from '@devdigest/shared';
import { buildIntentPrompt, computeConfidence, type IntentSignals } from '@devdigest/reviewer-core';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { ReviewRepository, PullRow } from './repository.js';
import { extractHunkHeaders, flattenHunkHeaders } from './hunk-headers.js';
import type * as schema from '../../db/schema.js';

type RepoRow = typeof schema.repos.$inferSelect;

/** Extract repo-internal plan/spec file links from a PR body. */
const PLAN_LINK_REGEX = /(?:docs|specs?|plans?)\/[\w\-.]+(?:\/[\w\-.]+)*\.md/gi;

/**
 * Attempt to read a plan/spec file from the clone directory via the git adapter.
 * Guards against path traversal: the relative path is normalized and checked
 * for `..` segments before passing to the git adapter.
 *
 * Returns the text (capped at 2000 chars) or null on failure / traversal attempt.
 */
async function tryReadPlanFile(git: GitClient, repo: RepoRef, relPath: string): Promise<string | null> {
  try {
    // Path traversal guard: normalize and reject any `..` segments
    const normalized = path.posix.normalize(relPath);
    if (normalized.startsWith('..') || normalized.includes('/..') || path.isAbsolute(normalized)) {
      return null;
    }

    const text = await git.readFile(repo, normalized);
    return text.slice(0, 2000);
  } catch {
    return null;
  }
}

/**
 * Classify the intent of a pull request using a cheap flash-class LLM.
 *
 * This is best-effort enrichment: if the LLM call fails, we log a warning
 * and return undefined so the parent review run continues without intent.
 *
 * Execution order:
 *   1. Gather signals (title, body, branch, commits, files, hunk headers)
 *   2. Re-fetch linked issue from GitHub (live API call)
 *   3. Extract plan/spec links from body and read from clone dir
 *   4. Compute confidence mechanically (overrides model self-report)
 *   5. Resolve flash model via feature_models setting
 *   6. Build prompt + call LLM → structured JSON
 *   7. Merge with mechanical confidence + persist
 *   8. Log sources, model, tokens, confidence
 */
export async function classifyIntent(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  repoRow: RepoRow,
  diff: UnifiedDiff,
  runLog: RunLogger,
): Promise<EnrichedIntent | undefined> {
  try {
    // 1. Gather signals
    const commits = await repo.getPrCommits(pull.id);
    const files = await repo.getPrFiles(pull.id);
    const hunkHeaderMap = extractHunkHeaders(diff.raw);
    const hunkHeaders = flattenHunkHeaders(hunkHeaderMap);

    // 2. Re-fetch linked issue via GitHub adapter (best-effort)
    let linkedIssue: { title: string; body?: string | null } | undefined;
    if (pull.body) {
      try {
        const github = await container.github();
        const issue = await github.getIssue(
          { owner: repoRow.owner, name: repoRow.name },
          // Extract issue number from PR body ("closes #123" / "fixes #123")
          extractIssueNumber(pull.body),
        );
        if (issue) {
          linkedIssue = { title: issue.title, body: issue.body };
        }
      } catch {
        // getIssue throws if no issue found or GitHub unavailable — ignore
      }
    }

    // 3. Extract plan/spec links from PR body (via git adapter, not direct fs)
    const planExcerpts: { path: string; text: string }[] = [];
    const unavailableLinks: string[] = [];
    if (pull.body) {
      const matches = [...pull.body.matchAll(PLAN_LINK_REGEX)].slice(0, 3);
      const git = container.git;
      const ref: RepoRef = { owner: repoRow.owner, name: repoRow.name };
      for (const match of matches) {
        const relPath = match[0];
        const text = await tryReadPlanFile(git, ref, relPath);
        if (text !== null) {
          planExcerpts.push({ path: relPath, text });
        } else {
          unavailableLinks.push(relPath);
        }
      }
    }

    // 4. Build signals object and compute mechanical confidence
    const signals: IntentSignals = {
      title: pull.title,
      body: pull.body ?? undefined,
      branch: pull.branch,
      commitMessages: commits.slice(0, 20).map((c) => c.message),
      filePaths: files.slice(0, 100).map((f) => f.path),
      hunkHeaders,
      linkedIssue,
      planExcerpts: planExcerpts.length > 0 ? planExcerpts : undefined,
      unavailableLinks: unavailableLinks.length > 0 ? unavailableLinks : undefined,
    };

    const confidence = computeConfidence(signals);

    // 5. Resolve flash model (workspace override or registry default)
    const { provider, model } = await resolveFeatureModel(container, workspaceId, 'review_intent');

    // 6. Build prompt + call LLM
    const messages = buildIntentPrompt(signals);
    const llm = await container.llm(provider as Parameters<Container['llm']>[0]);

    runLog.event('tool', `Intent classification: calling ${provider}/${model}`);
    const result = await llm.completeStructured({
      model,
      schema: IntentClassification,
      schemaName: 'IntentClassification',
      messages,
      temperature: 0.2,
      maxTokens: 1024,
    });

    // 7. Merge with mechanical confidence (overrides model self-report)
    const sources = {
      has_body: Boolean(pull.body && pull.body.trim().length > 0),
      has_linked_issue: Boolean(linkedIssue),
      plan_links_found: planExcerpts.length + unavailableLinks.length,
      plan_links_used: planExcerpts.length,
      plan_links_failed: unavailableLinks,
      commit_count: commits.length,
      file_count: files.length,
      hunk_headers_count: hunkHeaders.length,
    };

    const enriched: EnrichedIntent = {
      ...result.data,
      confidence,
      model,
      sources,
    };

    // 8. Persist
    await repo.upsertIntent(pull.id, enriched);

    // 9. Log (no secrets, no diff bodies, no full PR body text)
    runLog.event('info', 'Intent classified', {
      model,
      confidence,
      intent_type: result.data.intent_type,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      sources,
    });

    return enriched;
  } catch (err) {
    // Intent is best-effort — never fail the parent review run
    runLog.event('info', `Intent classification failed — continuing without intent: ${(err as Error).message}`);
    return undefined;
  }
}

/** Extract the first issue number from a PR body (e.g. "closes #123"). */
function extractIssueNumber(body: string): number {
  const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
  return m ? Number(m[1]) : 0;
}

