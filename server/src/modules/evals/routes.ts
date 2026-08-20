/**
 * Eval Pipeline — Fastify routes.
 *
 * All routes resolve workspace via getContext(). Routes delegate to
 * EvalsService following the onion pattern (routes → service → repository).
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateEvalCaseInput,
  UpdateEvalCaseInput,
  TimeRangeFilter,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalsService } from './service.js';

const CompareParams = z.object({
  a: z.string().uuid(),
  b: z.string().uuid(),
});

const PromoteBody = z.object({
  version: z.number().int().positive(),
});

const TimeRangeQuery = z.object({
  range: TimeRangeFilter.optional().default('30d'),
});

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalsService(app.container);

  // ---- Eval Cases -----------------------------------------------------------

  /** POST /agents/:id/eval-cases — Create an eval case for an agent. */
  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: CreateEvalCaseInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.createCase(workspaceId, req.params.id, req.body);
      reply.status(201);
      return result;
    },
  );

  /** GET /agents/:id/eval-cases — List eval cases for an agent. */
  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listCases(workspaceId, req.params.id);
  });

  /** GET /eval-cases/:id — Get a single eval case. */
  app.get('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getCase(workspaceId, req.params.id);
  });

  /** PUT /eval-cases/:id — Update an eval case. */
  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: UpdateEvalCaseInput } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateCase(workspaceId, req.params.id, req.body);
    },
  );

  /** DELETE /eval-cases/:id — Delete an eval case (cascades to runs). */
  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.deleteCase(workspaceId, req.params.id);
  });

  // ---- Eval Runs ------------------------------------------------------------

  /** POST /agents/:id/eval-runs — Start a batch eval run. Returns 202. */
  app.post('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.startBatch(workspaceId, req.params.id);
    reply.status(202);
    return result;
  });

  /** POST /eval-cases/:id/run — Run a single eval case (standalone). */
  app.post('/eval-cases/:id/run', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.runSingleCase(workspaceId, req.params.id);
  });

  // ---- Eval Batches ---------------------------------------------------------

  /** GET /agents/:id/eval-batches — List batches for an agent (with time range). */
  app.get(
    '/agents/:id/eval-batches',
    { schema: { params: IdParams, querystring: TimeRangeQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listBatches(workspaceId, req.params.id, req.query.range);
    },
  );

  /** GET /eval-batches/:id — Get a single batch with its runs. */
  app.get('/eval-batches/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getBatch(workspaceId, req.params.id);
  });

  /** GET /eval-batches/:a/compare/:b — Compare two batches. */
  app.get(
    '/eval-batches/:a/compare/:b',
    { schema: { params: CompareParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.compareBatches(workspaceId, req.params.a, req.params.b);
    },
  );

  // ---- Dashboards -----------------------------------------------------------

  /** GET /eval-dashboard — Workspace-wide eval dashboard. */
  app.get('/eval-dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getWorkspaceDashboard(workspaceId);
  });

  /** GET /agents/:id/eval-dashboard — Per-agent eval dashboard. */
  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams, querystring: TimeRangeQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getAgentDashboard(workspaceId, req.params.id, req.query.range);
    },
  );

  // ---- Promote --------------------------------------------------------------

  /** POST /agents/:id/promote — Promote to a previous version's config. */
  app.post(
    '/agents/:id/promote',
    { schema: { params: IdParams, body: PromoteBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.promoteVersion(workspaceId, req.params.id, req.body.version);
    },
  );
}
