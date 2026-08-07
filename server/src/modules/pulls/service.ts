import type { Container } from '../../platform/container.js';
import type {
  PrMetaFindings,
  PrDetail,
  GitHubClient,
  PrReviewComment,
  Severity,
  FindingCategory,
  FindingKind,
  SmartDiff,
} from '@devdigest/shared';
import { buildSmartDiff } from './classifier.js';
import { and, desc, eq, inArray } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { NotFoundError, AppError } from '../../platform/errors.js';
import { deriveReviewStatus } from './status.js';

/**
 * F1 — pulls service. PR import via Octokit (list + per-PR detail) and
 * inline review comments (proxied live to GitHub).
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 */
export class PullsService {
  constructor(
    private container: Container,
    private log: { warn: (obj: unknown, msg: string) => void },
  ) {}

  async listPulls(workspaceId: string, repoId: string): Promise<PrMetaFindings[]> {
    const [repo] = await this.container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    if (!repo) throw new NotFoundError('Repo not found');

    let gh: GitHubClient | null = null;
    try {
      gh = await this.container.github();
    } catch (err) {
      this.log.warn({ err }, 'GitHub client unavailable (no token / offline); serving persisted PRs');
    }

    if (gh) {
      try {
        const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
        for (const pr of pulls) {
          await this.container.db
            .insert(t.pullRequests)
            .values({
              workspaceId,
              repoId: repo.id,
              number: pr.number,
              title: pr.title,
              author: pr.author,
              branch: pr.branch,
              base: pr.base,
              headSha: pr.head_sha,
              additions: pr.additions,
              deletions: pr.deletions,
              filesCount: pr.files_count,
              status: pr.status,
              openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
              updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
            })
            .onConflictDoUpdate({
              target: [t.pullRequests.repoId, t.pullRequests.number],
              set: {
                title: pr.title,
                headSha: pr.head_sha,
                status: pr.status,
                updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
              },
            });
        }
      } catch (err) {
        this.log.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await this.container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo.id));

    // Backfill diff stats from detail endpoint for PRs with zeroed size
    const BACKFILL_LIMIT = 10;
    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
          await this.container.db
            .update(t.pullRequests)
            .set({
              additions: detail.additions,
              deletions: detail.deletions,
              filesCount: detail.files_count,
            })
            .where(eq(t.pullRequests.id, r.id));
          r.additions = detail.additions;
          r.deletions = detail.deletions;
          r.filesCount = detail.files_count;
        } catch (err) {
          this.log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    // Latest-review SCORE per PR
    const prIds = rows.map((r) => r.id);
    const latestReviewByPr = new Map<string, { score: number | null }>();
    if (prIds.length > 0) {
      const reviewRows = await this.container.db
        .select({ prId: t.reviews.prId, score: t.reviews.score })
        .from(t.reviews)
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
        .orderBy(desc(t.reviews.createdAt));
      for (const rv of reviewRows) {
        if (!latestReviewByPr.has(rv.prId)) latestReviewByPr.set(rv.prId, { score: rv.score });
      }
    }

    // Total run COST per PR
    const totalCostByPr = new Map<string, number | null>();
    if (prIds.length > 0) {
      const costRows = await this.container.db
        .select({ prId: t.agentRuns.prId, costUsd: t.agentRuns.costUsd })
        .from(t.agentRuns)
        .where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.status, 'done')));
      for (const cr of costRows) {
        if (!cr.prId) continue;
        const prev = totalCostByPr.get(cr.prId);
        if (cr.costUsd != null) {
          totalCostByPr.set(cr.prId, (prev ?? 0) + cr.costUsd);
        } else if (!totalCostByPr.has(cr.prId)) {
          totalCostByPr.set(cr.prId, null);
        }
      }
    }

    // Per-severity FINDING COUNTS + preview per PR
    interface PrFindingsAgg {
      critical: number;
      warning: number;
      suggestion: number;
      findings: {
        id: string;
        review_id: string;
        severity: Severity;
        category: FindingCategory;
        title: string;
        file: string;
        start_line: number;
        end_line: number;
        rationale: string;
        suggestion: string | null;
        confidence: number;
        kind: FindingKind;
        trifecta_components: string[] | null;
        accepted_at: string | null;
        dismissed_at: string | null;
      }[];
    }
    const sevCountsByPr = new Map<string, PrFindingsAgg>();
    if (prIds.length > 0) {
      const findingRows = await this.container.db
        .select({
          prId: t.reviews.prId,
          id: t.findings.id,
          reviewId: t.findings.reviewId,
          severity: t.findings.severity,
          category: t.findings.category,
          title: t.findings.title,
          file: t.findings.file,
          startLine: t.findings.startLine,
          endLine: t.findings.endLine,
          rationale: t.findings.rationale,
          suggestion: t.findings.suggestion,
          confidence: t.findings.confidence,
          kind: t.findings.kind,
          trifectaComponents: t.findings.trifectaComponents,
          acceptedAt: t.findings.acceptedAt,
          dismissedAt: t.findings.dismissedAt,
        })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')));
      for (const fr of findingRows) {
        if (!fr.prId) continue;
        let agg = sevCountsByPr.get(fr.prId);
        if (!agg) {
          agg = { critical: 0, warning: 0, suggestion: 0, findings: [] };
          sevCountsByPr.set(fr.prId, agg);
        }
        if (fr.severity === 'CRITICAL') agg.critical++;
        else if (fr.severity === 'WARNING') agg.warning++;
        else if (fr.severity === 'SUGGESTION') agg.suggestion++;
        agg.findings.push({
          id: fr.id,
          review_id: fr.reviewId,
          severity: fr.severity as Severity,
          category: fr.category as FindingCategory,
          title: fr.title,
          file: fr.file,
          start_line: fr.startLine,
          end_line: fr.endLine,
          rationale: fr.rationale,
          suggestion: fr.suggestion,
          confidence: fr.confidence,
          kind: fr.kind as FindingKind,
          trifecta_components: fr.trifectaComponents,
          accepted_at: fr.acceptedAt?.toISOString() ?? null,
          dismissed_at: fr.dismissedAt?.toISOString() ?? null,
        });
      }
    }

    const now = Date.now();
    return rows.map((r): PrMetaFindings => {
      const review = latestReviewByPr.get(r.id);
      const sev = sevCountsByPr.get(r.id);
      return {
        id: r.id,
        number: r.number,
        title: r.title,
        author: r.author,
        branch: r.branch,
        base: r.base,
        head_sha: r.headSha,
        additions: r.additions,
        deletions: r.deletions,
        files_count: r.filesCount,
        status: deriveReviewStatus({
          ghStatus: r.status,
          lastReviewedSha: r.lastReviewedSha,
          headSha: r.headSha,
          updatedAt: r.updatedAt,
          now,
        }),
        opened_at: r.openedAt?.toISOString() ?? null,
        updated_at: r.updatedAt?.toISOString() ?? null,
        score: review ? review.score : null,
        latest_cost_usd: totalCostByPr.get(r.id) ?? null,
        critical_count: sev ? sev.critical : null,
        warning_count: sev ? sev.warning : null,
        suggestion_count: sev ? sev.suggestion : null,
        findings_preview: sev?.findings as PrMetaFindings['findings_preview'],
      };
    });
  }

  async getDetail(workspaceId: string, prId: string): Promise<PrDetail> {
    const [pr] = await this.container.db
      .select()
      .from(t.pullRequests)
      .where(
        and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)),
      );
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');

    try {
      const gh = await this.container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);

      await this.container.db.delete(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      if (detail.files.length > 0) {
        await this.container.db.insert(t.prFiles).values(
          detail.files.map((f) => ({
            prId: pr.id,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
      await this.container.db.delete(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      if (detail.commits.length > 0) {
        await this.container.db.insert(t.prCommits).values(
          detail.commits.map((c) => ({
            prId: pr.id,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
      await this.container.db
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, pr.id));

      return { ...detail, id: pr.id };
    } catch (err) {
      this.log.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
      const files = await this.container.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      const commits = await this.container.db.select().from(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        head_sha: pr.headSha,
        additions: pr.additions,
        deletions: pr.deletions,
        files_count: pr.filesCount,
        status: pr.status as PrDetail['status'],
        opened_at: pr.openedAt?.toISOString() ?? null,
        updated_at: pr.updatedAt?.toISOString() ?? null,
        body: pr.body ?? null,
        files: files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committed_at: c.committedAt?.toISOString() ?? null,
        })),
      };
    }
  }

  async listComments(workspaceId: string, prId: string): Promise<PrReviewComment[]> {
    const { pr, repo } = await this.resolvePrAndRepo(prId, workspaceId);
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch (err) {
      this.log.warn({ err }, 'GitHub client unavailable; serving no PR comments');
      return [];
    }
    try {
      return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
    } catch (err) {
      this.log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  async createComment(
    workspaceId: string,
    prId: string,
    input: { path: string; line: number; side?: 'LEFT' | 'RIGHT'; body: string; in_reply_to?: number },
  ): Promise<PrReviewComment> {
    const { pr, repo } = await this.resolvePrAndRepo(prId, workspaceId);
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      throw new AppError(
        'github_unavailable',
        'Connect a GitHub token to post comments.',
        400,
      );
    }
    try {
      return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
        commitId: pr.headSha,
        path: input.path,
        line: input.line,
        ...(input.side ? { side: input.side } : {}),
        body: input.body,
        ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
      throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
    }
  }

  async getSmartDiff(workspaceId: string, prId: string): Promise<SmartDiff> {
    await this.resolvePrAndRepo(prId, workspaceId);

    const files = await this.container.db
      .select({ path: t.prFiles.path, additions: t.prFiles.additions, deletions: t.prFiles.deletions })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));

    if (files.length === 0) throw new NotFoundError('No files found for this pull request');

    // Fetch findings from the latest review (kind = 'review') if any.
    const [latestReview] = await this.container.db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(and(eq(t.reviews.prId, prId), eq(t.reviews.kind, 'review')))
      .orderBy(desc(t.reviews.createdAt))
      .limit(1);

    const findingsByFile = new Map<string, number[]>();

    if (latestReview) {
      const findingRows = await this.container.db
        .select({ file: t.findings.file, startLine: t.findings.startLine })
        .from(t.findings)
        .where(eq(t.findings.reviewId, latestReview.id));

      for (const row of findingRows) {
        const lines = findingsByFile.get(row.file) ?? [];
        lines.push(row.startLine);
        findingsByFile.set(row.file, lines);
      }
    }

    return buildSmartDiff(files, findingsByFile);
  }

  private async resolvePrAndRepo(prId: string, workspaceId: string) {
    const [pr] = await this.container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await this.container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }
}
