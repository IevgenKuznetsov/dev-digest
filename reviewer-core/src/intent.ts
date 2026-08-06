import type { ChatMessage } from '@devdigest/shared';
import { wrapUntrusted, hardenSystemPrompt } from './prompt.js';

/**
 * Intent classification prompt builder and mechanical confidence calculator.
 *
 * The intent classifier is a SEPARATE cheap flash-class model call that runs
 * before the per-agent review loop. It receives NO full diff bodies — only
 * file paths + hunk headers.
 *
 * All untrusted content (PR title, body, issue, commits, file paths, hunk
 * headers) is wrapped with wrapUntrusted() and hardenSystemPrompt() appends
 * the injection guard to the system prompt.
 */

export interface IntentSignals {
  /** PR title (untrusted — author-controlled). */
  title: string;
  /** PR body/description (untrusted; may be undefined if empty). */
  body?: string;
  /** Branch name (untrusted, but lower risk). */
  branch: string;
  /** Commit messages, capped at 20 (untrusted). */
  commitMessages: string[];
  /** File paths changed, capped at 100 (untrusted). */
  filePaths: string[];
  /** Hunk header texts extracted from `@@ ... @@ <context>` lines (untrusted). */
  hunkHeaders: string[];
  /** Linked GitHub issue (untrusted — user-controlled issue content). */
  linkedIssue?: { title: string; body?: string | null };
  /** Plan/spec file excerpts from the repo, capped at 3 × 2000 chars (untrusted). */
  planExcerpts?: { path: string; text: string }[];
  /** Links referenced in the PR body that could not be fetched. */
  unavailableLinks?: string[];
}

const SYSTEM_PROMPT = `You are a PR intent classifier. Given PR metadata, \
classify the intent and scope of the pull request.

Return structured JSON with:
- summary: one sentence describing what this PR aims to accomplish
- in_scope: list of things this PR explicitly intends to change or improve
- out_of_scope: list of related things this PR deliberately does NOT address
- risk_areas: list of risk areas (e.g. "Auth surface touched", "New dependency")
- intent_type: one of feature|bug_fix|refactor|chore|security_patch|performance|test

Guidelines:
- Base your classification ONLY on the provided metadata
- Do NOT invent content for unavailable links or missing data
- If description is sparse, classify from title + files + commits and note lower certainty
- Keep each list item concise (under 10 words)
- risk_areas should highlight non-obvious risks, not just "code changed"`;

/**
 * Build the messages array for the intent classification LLM call.
 * All untrusted content is wrapped with wrapUntrusted().
 * INJECTION_GUARD is appended to the system prompt.
 */
export function buildIntentPrompt(signals: IntentSignals): ChatMessage[] {
  const system = hardenSystemPrompt(SYSTEM_PROMPT);

  const sections: string[] = [];

  // PR title — primary signal (untrusted)
  sections.push(`## PR Title\n${wrapUntrusted('pr-title', signals.title)}`);

  // Branch name (lower risk but still untrusted)
  sections.push(`## Branch\n${wrapUntrusted('branch-name', signals.branch)}`);

  // PR body (untrusted; may be empty)
  if (signals.body && signals.body.trim().length > 0) {
    const truncated = signals.body.slice(0, 4000);
    sections.push(`## PR Description\n${wrapUntrusted('pr-description', truncated)}`);
  } else {
    sections.push('## PR Description\n(No description provided)');
  }

  // Commit messages (untrusted)
  if (signals.commitMessages.length > 0) {
    const commits = signals.commitMessages
      .slice(0, 20)
      .map((m, i) => `${i + 1}. ${m}`)
      .join('\n');
    sections.push(`## Commit Messages\n${wrapUntrusted('commits', commits)}`);
  }

  // File paths changed (untrusted)
  if (signals.filePaths.length > 0) {
    const paths = signals.filePaths.slice(0, 100).join('\n');
    sections.push(`## Changed Files\n${wrapUntrusted('file-paths', paths)}`);
  }

  // Hunk headers (untrusted — function/class names from diff)
  if (signals.hunkHeaders.length > 0) {
    const headers = signals.hunkHeaders.join('\n');
    sections.push(`## Modified Functions/Classes (from diff)\n${wrapUntrusted('hunk-headers', headers)}`);
  }

  // Linked issue (untrusted — user-controlled issue content)
  if (signals.linkedIssue) {
    const issueText = `Title: ${signals.linkedIssue.title}${
      signals.linkedIssue.body ? `\n\n${signals.linkedIssue.body.slice(0, 2000)}` : ''
    }`;
    sections.push(`## Linked Issue\n${wrapUntrusted('linked-issue', issueText)}`);
  }

  // Plan/spec excerpts (untrusted — repo file content)
  if (signals.planExcerpts && signals.planExcerpts.length > 0) {
    for (const excerpt of signals.planExcerpts.slice(0, 3)) {
      sections.push(
        `## Plan/Spec: ${excerpt.path}\n${wrapUntrusted(`plan-${excerpt.path}`, excerpt.text.slice(0, 2000))}`,
      );
    }
  }

  // Unavailable links — explicitly tell the model NOT to fabricate
  if (signals.unavailableLinks && signals.unavailableLinks.length > 0) {
    const links = signals.unavailableLinks.join('\n');
    sections.push(
      `## Unavailable Links\nThe following links were referenced in the PR but could not be fetched.\n` +
        `Do NOT fabricate their content. Note the gap in your classification:\n${links}`,
    );
  }

  const user = sections.join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Compute confidence MECHANICALLY from available signals.
 * This value OVERRIDES the model's self-reported confidence.
 *
 * high   — strong signals: body + (linked issue OR plan excerpts) + commits
 * medium — partial signals: body OR (commits + files)
 * low    — minimal signals: only title + branch + files
 */
export function computeConfidence(signals: IntentSignals): 'high' | 'medium' | 'low' {
  const hasBody = Boolean(signals.body && signals.body.trim().length > 20);
  const hasLinkedIssue = Boolean(signals.linkedIssue);
  const hasPlanExcerpts = Boolean(signals.planExcerpts && signals.planExcerpts.length > 0);
  const hasCommits = signals.commitMessages.length > 0;
  const hasHunkHeaders = signals.hunkHeaders.length > 0;

  // High: body present AND at least one enrichment (issue / plan / hunk headers)
  if (hasBody && (hasLinkedIssue || hasPlanExcerpts || (hasHunkHeaders && hasCommits))) {
    return 'high';
  }

  // Medium: body present, OR commits + files present
  if (hasBody || (hasCommits && signals.filePaths.length > 0)) {
    return 'medium';
  }

  // Low: only title + branch + files
  return 'low';
}
