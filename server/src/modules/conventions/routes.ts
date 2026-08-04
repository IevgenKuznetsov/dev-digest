import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions module.
 *   GET    /repos/:id/conventions          → list conventions for a repo
 *   POST   /repos/:id/conventions/extract  → run extraction pipeline
 *   PATCH  /conventions/:id                → accept/reject one convention
 *   PATCH  /conventions/batch              → batch accept/reject
 *   DELETE /repos/:id/conventions          → clear all conventions for a repo
 *   POST   /repos/:id/conventions/skill    → create skill from accepted conventions
 */

const AcceptBody = z.object({
  accepted: z.boolean(),
});

const BatchAcceptBody = z.object({
  ids: z.array(z.string().uuid()).min(1),
  accepted: z.boolean(),
});

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.post('/repos/:id/conventions/extract', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.extract(workspaceId, req.params.id);
  });

  app.patch('/conventions/:id', { schema: { params: IdParams, body: AcceptBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.updateAccepted(workspaceId, req.params.id, req.body.accepted);
    if (!result) throw new NotFoundError('Convention not found');
    return result;
  });

  app.patch('/conventions/batch', { schema: { body: BatchAcceptBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const updated = await service.batchUpdateAccepted(workspaceId, req.body.ids, req.body.accepted);
    return { updated };
  });

  app.delete('/repos/:id/conventions', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.clearForRepo(workspaceId, req.params.id);
    return reply.status(204).send();
  });

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: CreateSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.createSkillFromConventions(
        workspaceId,
        req.params.id,
        req.body.name,
        req.body.description,
      );
      return reply.status(201).send(skill);
    },
  );
}
