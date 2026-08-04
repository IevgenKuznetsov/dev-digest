import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType, SkillSource } from '@devdigest/shared';
import { eq, and } from 'drizzle-orm';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import * as t from '../../db/schema.js';

/**
 * A1 — skills module.
 *   GET    /skills                            → list (workspace-scoped)
 *   GET    /skills/:id                        → one skill
 *   POST   /skills                            → create
 *   PUT    /skills/:id                        → update
 *   DELETE /skills/:id                        → delete
 *   GET    /skills/:id/versions               → version history
 *   POST   /skills/:id/versions/:ver/restore  → restore body from past version
 *   GET    /skills/:id/eval-cases             → eval cases for this skill
 *   POST   /skills/import/preview             → parse markdown, return preview (no persist)
 *   POST   /skills/import/confirm             → persist previewed skill
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType,
  source: SkillSource.optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

const ImportPreviewBody = z.object({
  body: z.string().min(1),
  name: z.string().optional(),
});

const ImportConfirmBody = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType,
  source: SkillSource.optional(),
  body: z.string().min(1),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    return reply.status(201).send(skill);
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const deleted = await service.delete(workspaceId, req.params.id);
    if (!deleted) throw new NotFoundError('Skill not found');
    return reply.status(204).send();
  });

  // ---- Versions ----

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return service.listVersions(req.params.id);
  });

  const VersionParams = z.object({ id: z.string().uuid(), ver: z.coerce.number().int().positive() });

  app.post('/skills/:id/versions/:ver/restore', { schema: { params: VersionParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.restoreVersion(workspaceId, req.params.id, req.params.ver);
    if (!skill) throw new NotFoundError('Skill or version not found');
    return skill;
  });

  // ---- Eval cases (read-only for now — eval module will own mutations) ----

  app.get('/skills/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    const cases = await app.container.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerId, req.params.id), eq(t.evalCases.ownerKind, 'skill')));
    return cases.map((c) => ({
      id: c.id,
      name: c.name,
      notes: c.notes,
    }));
  });

  // ---- Stats ----

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');

    // Agents using this skill
    const agentLinks = await app.container.db
      .select({ agentId: t.agentSkills.agentId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, req.params.id));

    const agentNames: Array<{ id: string; name: string }> = [];
    for (const link of agentLinks) {
      const [agent] = await app.container.db
        .select({ id: t.agents.id, name: t.agents.name })
        .from(t.agents)
        .where(eq(t.agents.id, link.agentId));
      if (agent) agentNames.push(agent);
    }

    return {
      used_by_agents: agentNames,
      agents_count: agentNames.length,
    };
  });

  // ---- Import ----

  app.post(
    '/skills/import/preview',
    { schema: { body: ImportPreviewBody } },
    async (req) => {
      return service.importPreview(req.body.body, req.body.name);
    },
  );

  app.post(
    '/skills/import/confirm',
    { schema: { body: ImportConfirmBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.importConfirm(workspaceId, req.body);
      return reply.status(201).send(skill);
    },
  );
}
