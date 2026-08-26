/**
 * Multi-Agent Review — Fastify routes.
 *
 * All routes resolve workspace via getContext(). Routes delegate to
 * MultiAgentReviewService following the onion pattern.
 *
 * Endpoints:
 *   POST /pulls/:prId/multi-agent-run    — create and execute a multi-agent run
 *   GET  /multi-agent-run/:id            — fetch run results (workspace-scoped)
 *   GET  /agents/estimates               — pre-run cost/duration estimate
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MultiAgentRunRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { MultiAgentReviewService } from './service.js';

const PrIdParams = z.object({ prId: z.string().uuid() });
const RunIdParams = z.object({ id: z.string().uuid() });

export default async function multiAgentReviewRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new MultiAgentReviewService(app.container);

  /**
   * POST /pulls/:prId/multi-agent-run
   * Create a coordinated multi-agent run. Returns the multi-agent run ID and
   * per-agent run stubs immediately; execution continues in the background.
   *
   * Rate-limited: 10 req/min (each call can spawn expensive LLM runs).
   */
  app.post(
    '/pulls/:prId/multi-agent-run',
    {
      schema: { params: PrIdParams, body: MultiAgentRunRequest },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.createAndExecute(
        workspaceId,
        req.params.prId,
        req.body.agent_ids,
        req.log,
      );
      reply.status(201);
      return result;
    },
  );

  /**
   * GET /multi-agent-run/:id
   * Fetch full multi-agent run results including columns, conflicts, and stats.
   * Workspace-scoped: returns 404 if not found or belongs to another workspace.
   * No prId in path — the client navigates with only the run ID.
   */
  app.get(
    '/multi-agent-run/:id',
    { schema: { params: RunIdParams }, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getMultiAgentRun(workspaceId, req.params.id);
    },
  );

  /**
   * GET /agents/estimates
   * Pre-run cost/duration estimates based on historical agent run data.
   * Returns per-agent and aggregate estimates; is_partial=true when some agents
   * have no historical data.
   */
  app.get(
    '/agents/estimates',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getEstimates(workspaceId);
    },
  );
}
