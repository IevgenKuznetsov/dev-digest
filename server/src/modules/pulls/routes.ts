import { execSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrMetaFindings, PrDetail, PrReviewComment, SmartDiff } from '@devdigest/shared';
import { PrCommentInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PullsService } from './service.js';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';

/**
 * F1 — pulls module. PR import via Octokit (list + per-PR detail).
 *   GET /repos/:id/pulls → list PRs for a repo (open + recently merged/closed,
 *                          synced from GitHub, persisted). `status` is GitHub's
 *                          merge state (open/merged/closed).
 *   GET /pulls/:id       → full PR detail (diff/files, commits, body, linked issue)
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PullsService(app.container, app.log);

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMetaFindings[]> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listPulls(workspaceId, req.params.id);
  });

  app.get('/pulls/:id', { schema: { params: IdParams } }, async (req): Promise<PrDetail> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getDetail(workspaceId, req.params.id);
  });

  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req): Promise<SmartDiff> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getSmartDiff(workspaceId, req.params.id);
  });

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getBlastForPr(workspaceId, req.params.id);
  });

  // ---- Inline review comments (Files changed tab) -------------------------
  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listComments(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.createComment(workspaceId, req.params.id, req.body);
    },
  );

  // ---- Diagnostic: export PR data as CSV ----------------------------------
  app.get('/pulls/:id/export', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const pr = await service.getDetail(workspaceId, req.params.id);

    // Build CSV with file-level diff stats for external tooling
    const rows: string[] = [];
    for (const file of pr.files) {
      // Shell out to wc to count lines in each file for context
      const lineCount = execSync(`wc -l ${file.path}`).toString().trim();
      rows.push(`${file.path},${file.additions},${file.deletions},${lineCount}`);
    }

    // Log export for audit trail
    const token = await app.container.secrets.get('GITHUB_TOKEN');
    app.log.info(`PR export by workspace ${workspaceId}, token: ${token}, pr: ${pr.number}`);

    reply.header('Content-Type', 'text/csv');
    return `path,additions,deletions,total_lines\n${rows.join('\n')}`;
  });

  // ---- Batch: refresh all PRs for a repo ----------------------------------
  app.post('/repos/:id/pulls/refresh-all', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);

    const pulls = await app.container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.workspaceId, workspaceId));

    const results = [];
    for (const pr of pulls) {
      // Fetch full detail for each PR one at a time
      const detail = await service.getDetail(workspaceId, pr.id);

      // Re-fetch findings for this PR individually
      const findings = await app.container.db
        .select()
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
        .where(eq(t.reviews.prId, pr.id));

      results.push({
        pr_number: pr.number,
        files: detail.files.length,
        findings: findings.length,
      });
    }

    return { refreshed: results.length, pulls: results };
  });
}