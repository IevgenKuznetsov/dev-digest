import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';

import { getContext } from '../_shared/context.js';
import { AppError } from '../../platform/errors.js';
import { ProjectContextService } from './service.js';
import {
  RepoIdParams,
  DocIdParams,
  AgentIdParams,
  SkillIdParams,
  CreateDocBody,
  UpdateContentBody,
  CreateFolderBody,
  SetContextBody,
  ListDocsQuery,
} from './helpers.js';

/**
 * project-context module.
 *
 * Routes:
 *   POST   /repos/:repoId/context/scan
 *   GET    /repos/:repoId/context/docs
 *   GET    /repos/:repoId/context/docs/:docId
 *   GET    /repos/:repoId/context/docs/:docId/content
 *   PUT    /repos/:repoId/context/docs/:docId/content
 *   POST   /repos/:repoId/context/docs
 *   DELETE /repos/:repoId/context/docs/:docId
 *   POST   /repos/:repoId/context/docs/upload  (multipart)
 *   POST   /repos/:repoId/context/folders
 *   GET    /agents/:agentId/context
 *   PUT    /agents/:agentId/context
 *   GET    /skills/:skillId/context
 *   PUT    /skills/:skillId/context
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  // Register multipart support locally (does not affect other modules).
  await app.register(multipart, { limits: { fileSize: 500 * 1024 } });

  // Register the context-scan job handler.
  app.container.jobs.register('context-scan', async (payload) => {
    const { workspaceId, repoId } = payload as { workspaceId: string; repoId: string };
    await service.scan(workspaceId, repoId);
  });

  // ---- Context document discovery & management ----------------------------

  /**
   * POST /repos/:repoId/context/scan
   * Trigger an async file scan. Returns 409 if a scan is already running.
   */
  app.post(
    '/repos/:repoId/context/scan',
    { schema: { params: RepoIdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const { repoId } = req.params;

      const running = await service.isScanRunning(repoId);
      if (running) {
        throw new AppError('scan_conflict', 'A scan is already running for this repository', 409);
      }

      const job = await app.container.jobs.enqueue(workspaceId, 'context-scan', {
        workspaceId,
        repoId,
      });

      reply.status(202);
      return { jobId: job.id };
    },
  );

  /**
   * GET /repos/:repoId/context/docs
   * List all context documents for a repo, with optional search.
   */
  app.get(
    '/repos/:repoId/context/docs',
    { schema: { params: RepoIdParams, querystring: ListDocsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listDocs(workspaceId, req.params.repoId, req.query.search);
    },
  );

  /**
   * GET /repos/:repoId/context/docs/:docId
   * Get metadata for a single context document.
   */
  app.get(
    '/repos/:repoId/context/docs/:docId',
    { schema: { params: DocIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDoc(workspaceId, req.params.docId);
    },
  );

  /**
   * GET /repos/:repoId/context/docs/:docId/content
   * Read raw markdown content from disk.
   */
  app.get(
    '/repos/:repoId/context/docs/:docId/content',
    { schema: { params: DocIdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const content = await service.readContent(workspaceId, req.params.docId);
      reply.type('text/plain; charset=utf-8');
      return content;
    },
  );

  /**
   * PUT /repos/:repoId/context/docs/:docId/content
   * Write updated content to disk and recalculate token count.
   */
  app.put(
    '/repos/:repoId/context/docs/:docId/content',
    { schema: { params: DocIdParams, body: UpdateContentBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.writeContent(workspaceId, req.params.docId, req.body.content);
    },
  );

  /**
   * POST /repos/:repoId/context/docs
   * Create a new context file on disk and register it in the DB.
   */
  app.post(
    '/repos/:repoId/context/docs',
    { schema: { params: RepoIdParams, body: CreateDocBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const doc = await service.createDoc(
        workspaceId,
        req.params.repoId,
        req.body.directory,
        req.body.filename,
        req.body.content,
      );
      reply.status(201);
      return doc;
    },
  );

  /**
   * DELETE /repos/:repoId/context/docs/:docId
   * Delete the context file from disk and from the DB.
   */
  app.delete(
    '/repos/:repoId/context/docs/:docId',
    { schema: { params: DocIdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.deleteDoc(workspaceId, req.params.docId);
      reply.status(204);
    },
  );

  /**
   * POST /repos/:repoId/context/docs/upload
   * Upload a .md file into a context directory (multipart form).
   * Form fields: file (binary), directory ('specs' | 'docs').
   */
  app.post(
    '/repos/:repoId/context/docs/upload',
    { schema: { params: RepoIdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);

      interface MultipartFile {
        filename?: string;
        fields?: Record<string, { value: string }>;
        toBuffer: () => Promise<Buffer>;
      }
      const data = await (req as { file: () => Promise<MultipartFile | null> }).file();
      if (!data) throw new AppError('upload_error', 'No file provided', 400);

      const directoryField = data.fields?.['directory'];
      const directoryValue = directoryField?.value;

      if (!directoryValue || !['specs', 'docs'].includes(directoryValue)) {
        throw new AppError('upload_error', "Field 'directory' must be 'specs' or 'docs'", 400);
      }

      if (!data.filename || !data.filename.endsWith('.md')) {
        throw new AppError('upload_error', 'Only .md files are accepted', 400);
      }

      const content = (await data.toBuffer()).toString('utf8');

      const doc = await service.createDoc(
        workspaceId,
        req.params.repoId,
        directoryValue as 'specs' | 'docs',
        data.filename,
        content,
      );
      reply.status(201);
      return doc;
    },
  );

  // ---- Folder management ---------------------------------------------------

  /**
   * POST /repos/:repoId/context/folders
   * Create a new folder in a context directory.
   */
  app.post(
    '/repos/:repoId/context/folders',
    { schema: { params: RepoIdParams, body: CreateFolderBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.createFolder(
        workspaceId,
        req.params.repoId,
        req.body.directory,
        req.body.name,
      );
      reply.status(201);
      return result;
    },
  );

  // ---- Agent context attachments -------------------------------------------

  /**
   * GET /agents/:agentId/context
   * List context docs attached to an agent, plus total available count.
   */
  app.get(
    '/agents/:agentId/context',
    { schema: { params: AgentIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getAgentContext(workspaceId, req.params.agentId);
    },
  );

  /**
   * PUT /agents/:agentId/context
   * Replace the full set of attached docs with ordering.
   */
  app.put(
    '/agents/:agentId/context',
    { schema: { params: AgentIdParams, body: SetContextBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.setAgentContext(workspaceId, req.params.agentId, req.body.docs);
      reply.status(204);
    },
  );

  // ---- Skill context attachments -------------------------------------------

  /**
   * GET /skills/:skillId/context
   * List context docs attached to a skill.
   */
  app.get(
    '/skills/:skillId/context',
    { schema: { params: SkillIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getSkillContext(workspaceId, req.params.skillId);
    },
  );

  /**
   * PUT /skills/:skillId/context
   * Replace the full set of attached docs for a skill.
   */
  app.put(
    '/skills/:skillId/context',
    { schema: { params: SkillIdParams, body: SetContextBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.setSkillContext(workspaceId, req.params.skillId, req.body.docs);
      reply.status(204);
    },
  );
}
