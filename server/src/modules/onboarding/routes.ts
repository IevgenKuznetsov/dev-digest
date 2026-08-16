/**
 * Onboarding module routes.
 *
 *   GET  /repos/:id/onboarding  — retrieve the current tour (or { status: 'generating' })
 *   POST /repos/:id/onboarding  — generate or regenerate the tour
 *
 * The module is registered in server/src/modules/index.ts.
 *
 * Per-route timeout: the POST handler calls request.raw.setTimeout(65_000) to give
 * the 60s LLM call room to complete before the socket fires a timeout event.
 * This is a Node.js http.IncomingMessage.setTimeout() call — Fastify 5 does not
 * provide a built-in per-route timeout in route shorthand options.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { GenerateOnboardingBody } from '@devdigest/shared';
import { z } from 'zod';

// The body schema is optional — a body-less POST (no Content-Type header) must
// also succeed. Fastify rejects empty bodies with a schema defined, so we wrap
// GenerateOnboardingBody as an optional union with a null/undefined fallback.
// This preserves validation when a body IS provided while allowing no-body calls.
const OptionalGenerateBody = z.union([GenerateOnboardingBody, z.undefined(), z.null()]).optional();

export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /repos/:id/onboarding
   * Returns the current onboarding tour or { status: 'generating' } if in-flight.
   * Returns 404 if no tour has been generated yet.
   */
  app.get(
    '/repos/:id/onboarding',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await app.container.onboarding.getOnboarding(workspaceId, req.params.id);

      if (!result) {
        throw new NotFoundError('No onboarding tour found for this repository');
      }

      // Both OnboardingResult and OnboardingGenerating are valid 200 responses.
      // We omit the Fastify response schema here so neither shape is stripped by
      // the serializer (polymorphic 200 — AC-S1, RF-6).
      return reply.send(result);
    },
  );

  /**
   * POST /repos/:id/onboarding
   * Generate or regenerate the onboarding tour for a repo.
   * Sets a 65s socket timeout as a safety net for the 60s LLM call.
   *
   * Error responses (handled by global error handler):
   *   - 404: repo not in workspace
   *   - 409: generation already in progress
   *   - 500: LLM parse exhaustion after 2 attempts
   *   - 502: LLM network/provider error
   *   - 504: LLM timeout
   */
  app.post(
    '/repos/:id/onboarding',
    { schema: { params: IdParams, body: OptionalGenerateBody } },
    async (req, reply) => {
      // Per-route timeout: 65s gives the 60s LLM deadline room to fire first.
      // If the LLM call hangs without triggering withTimeout, this socket timeout
      // fires as a safety net. We manually send 504 if the reply hasn't been sent.
      // Guard: req.raw.setTimeout is not available in test inject() calls.
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
      const body = req.body as z.infer<typeof OptionalGenerateBody>;
      const language = (body && typeof body === 'object' && 'language' in body ? body.language : undefined) ?? 'en';
      const result = await app.container.onboarding.generateOnboarding(workspaceId, req.params.id, language);
      return reply.send(result);
    },
  );
}
