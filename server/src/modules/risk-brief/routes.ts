/**
 * Risk Brief module routes.
 *
 *   GET  /pulls/:id/brief  — retrieve the current risk brief (or { status: 'generating' })
 *   POST /pulls/:id/brief  — generate or regenerate the risk brief
 *
 * The module is registered in server/src/modules/index.ts.
 *
 * Per-route timeout: the POST handler calls request.raw.setTimeout(65_000) to give
 * the 60s LLM call room to complete before the socket fires a timeout event.
 * Guard: req.raw.setTimeout is not available in test inject() calls — see INSIGHTS.md.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { z } from 'zod';

// Body-less POST accepted — same pattern as onboarding routes.
const OptionalBody = z.union([z.object({}).passthrough(), z.undefined(), z.null()]).optional();

export default async function riskBriefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /pulls/:id/brief
   * Returns the current risk brief, { status: 'generating' } if in-flight,
   * or 404 if no brief has been generated yet.
   */
  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await app.container.riskBrief.getBrief(workspaceId, req.params.id);

      if (!result) {
        throw new NotFoundError('No risk brief found for this pull request');
      }

      // Both RiskBriefResponse and { status: 'generating' } are valid 200 responses.
      // Omit Fastify response schema so neither shape is stripped by the serializer.
      return reply.send(result);
    },
  );

  /**
   * POST /pulls/:id/brief
   * Generate or regenerate the risk brief for a PR.
   * Sets a 65s socket timeout as a safety net for the 60s LLM call.
   */
  app.post(
    '/pulls/:id/brief',
    { schema: { params: IdParams, body: OptionalBody } },
    async (req, reply) => {
      // Per-route timeout: 65s gives the 60s LLM deadline room to fire first.
      // Guard: req.raw.setTimeout is not available in test inject() calls (INSIGHTS.md).
      if (typeof req.raw.setTimeout === 'function') {
        req.raw.setTimeout(65_000);
        req.raw.once('timeout', () => {
          if (!reply.sent) {
            reply.status(504).send({
              error: { code: 'request_timeout', message: 'Request timed out' },
            });
          }
        });
      }

      const { workspaceId } = await getContext(app.container, req);
      const result = await app.container.riskBrief.generateBrief(workspaceId, req.params.id);
      return reply.send(result);
    },
  );
}
