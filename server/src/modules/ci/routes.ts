import { timingSafeEqual as nodeTse } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportInput, CiResultArtifact, PerfWindow } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, ValidationError } from '../../platform/errors.js';
import { CiService } from './service.js';
import { CI_INGEST_TOKEN_KEY } from './constants.js';
import { isPrivateNetworkStudioUrl, isSelfHostedRunnerLabel } from './helpers.js';

/**
 * A6 — ci module routes.
 *
 * Routes:
 * - Step 7: POST   /ci/ingest              — token-authed, NO getContext
 * - Step 9: GET    /ci/runs                — getContext, optional filters
 * - Step 9: GET    /ci/installations       — getContext, optional agent_id filter
 * - v2:     GET    /ci/performance         — getContext, windowed dashboard (AC-U1)
 * - v2:     DELETE /ci/installations/:id   — getContext, removes one install row (AC-E5)
 * - Step 9: POST   /agents/:id/export-ci   — getContext, delegates to service.exportCi
 *
 * IMPORTANT: POST /ci/ingest is the ONLY route that does NOT call getContext
 * (it authenticates via CI_INGEST_TOKEN instead). All other routes call
 * getContext first (AC-U2).
 */

// ---- Route-local request schemas -------------------------------------------

/**
 * Export body: extends CiExportInput with an optional workflow_override field
 * that carries the wizard's edited YAML through to the commit step unchanged
 * (AC-E3). The `repo` field is further validated as `owner/name`.
 */
export const ExportBody = CiExportInput.extend({
  /**
   * When set, the service uses this YAML verbatim as the workflow file instead
   * of calling generateWorkflow (AC-E3). Author-edited content committed only
   * to the devdigest/ci branch; never to main.
   */
  workflow_override: z.string().nullish(),
  /**
   * Self-hosted runner label for the generated workflow's `runs-on:` (AC-U9,
   * AC-E4b). Falls back to DEFAULT_RUNNER_LABEL when omitted. Must include
   * the literal `self-hosted` label — the spec mandates the studio is
   * reachable ONLY via a self-hosted runner (never GitHub-hosted compute),
   * and `runs-on:` silently routes to GitHub-hosted infra if that label is
   * absent (see `isSelfHostedRunnerLabel` in helpers.ts).
   */
  runner_label: z
    .array(z.string())
    .min(1)
    .refine(isSelfHostedRunnerLabel, {
      message:
        'runner_label must include the "self-hosted" label — GitHub-hosted runners ' +
        'are not permitted (the studio is reachable only via a self-hosted runner)',
    })
    .optional(),
  /**
   * Studio base URL provisioned into the target repo's DEVDIGEST_STUDIO_URL
   * Actions variable (AC-E6, AC-E4b). Falls back to DEFAULT_STUDIO_URL when
   * omitted. Never interpolated directly into workflow YAML (AC-U7). Must
   * resolve to a private-network host (localhost / RFC1918) — the spec
   * mandates the studio is reachable only via a self-hosted runner on the
   * operator's private network, never a public tunnel/relay. Rejecting
   * public hosts here also prevents an attacker-controlled `studio_url`
   * from exfiltrating the shared CI_INGEST_TOKEN.
   */
  studio_url: z
    .string()
    .min(1)
    .refine(isPrivateNetworkStudioUrl, {
      message:
        'studio_url must be an http(s) URL pointing to a private-network host ' +
        '(localhost, 127.0.0.1, or an RFC1918 private range) — public/tunnel URLs are not permitted',
    })
    .optional(),
}).refine(
  (b) => /^[^/\s]+\/[^/\s]+$/.test(b.repo),
  { message: 'repo must be in "owner/name" format', path: ['repo'] },
);
export type ExportBody = z.infer<typeof ExportBody>;

/**
 * Ingest body: the CiResultArtifact plus the route-level fields
 * `repository` and `commit_sha` that CiResultArtifact itself does not carry
 * (they come from the CI runner's env, not the artifact file — AC-E6, AC-UN2).
 */
const IngestBody = z.object({
  // Route-level provenance fields (not in CiResultArtifact)
  repository: z
    .string()
    .min(1)
    .regex(/^[^/\s]+\/[^/\s]+$/, 'repository must be in "owner/name" format'),
  commit_sha: z
    .string()
    .min(1)
    .regex(/^[0-9a-f]{7,40}$/i, 'commit_sha must be a valid git SHA'),
  // Spread in all fields from CiResultArtifact
}).and(CiResultArtifact);
type IngestBody = z.infer<typeof IngestBody>;

/**
 * Query schema for GET /ci/runs.
 */
const CiRunsQuery = z.object({
  repo: z.string().optional(),
  agent: z.string().uuid().optional(),
  source: z.string().optional(),
  status: z.string().optional(),
});

/**
 * Query schema for GET /ci/installations.
 */
const CiInstallationsQuery = z.object({
  agent_id: z.string().uuid().optional(),
});

/**
 * Query schema for GET /ci/performance.
 *
 * `window` defaults to '30' when absent (AC-O3). A present-but-invalid value
 * (not in {7,30,90}) fails Fastify/Zod schema validation and is rejected
 * with 422 by the app's error handler (AC-UN1) — no silent fallback.
 */
const CiPerformanceQuery = z.object({
  window: PerfWindow.default('30'),
});

// ---- Plugin -----------------------------------------------------------------

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);

  // ---- POST /ci/ingest -------------------------------------------------------
  // The ONLY route in this module that does NOT call getContext (AC-U2).
  // Authenticated via CI_INGEST_TOKEN bearer token (AC-UN1).
  // Validation order: token → schema → installation-match → persist.
  // Fail-closed: nothing is persisted until all checks pass.

  app.post(
    '/ci/ingest',
    { schema: { body: IngestBody }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      // 1. Token validation (AC-UN1).
      //    Read from Authorization: Bearer <token> header.
      //    Never log the token value.
      const authHeader = req.headers['authorization'];
      const providedToken = authHeader?.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : undefined;

      if (!providedToken) {
        throw new AppError('unauthorized', 'Invalid CI ingest token', 401);
      }

      // Retrieve expected token through SecretsProvider (never from env directly
      // in this layer — SecretsProvider already falls back to process.env).
      const expectedToken = await app.container.secrets.get(CI_INGEST_TOKEN_KEY);
      if (!expectedToken) {
        // Token not configured — fail closed.
        throw new AppError('unauthorized', 'Invalid CI ingest token', 401);
      }

      // Constant-time-ish comparison to mitigate timing attacks.
      // Both strings are converted to buffers and compared byte-by-byte.
      if (!timingSafeEqual(providedToken, expectedToken)) {
        throw new AppError('unauthorized', 'Invalid CI ingest token', 401);
      }

      // 2. Schema already validated by Fastify + Zod at the route level.
      //    The body is IngestBody (CiResultArtifact + repository + commit_sha).
      const { repository, commit_sha, ...artifact } = req.body;

      // 3. Installation match: find the installation for this repo (AC-UN2).
      //    Persist nothing if not found.
      const ciRepo = service['repo'];
      const installation = await ciRepo.findInstallationByRepo(repository);
      if (!installation) {
        throw new ValidationError(
          `No CI installation found for repository "${repository}". ` +
            `Export the agent to this repo first via POST /agents/:id/export-ci.`,
        );
      }

      // 4. Delegate to service for transactional persistence (Steps 8).
      await service.ingest({ artifact, repository, commitSha: commit_sha, installation });

      return { ok: true };
    },
  );

  // ---- GET /ci/runs ----------------------------------------------------------

  app.get(
    '/ci/runs',
    { schema: { querystring: CiRunsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { repo, agent, status } = req.query;
      return service.listRuns(workspaceId, { repo, agentId: agent, status });
    },
  );

  // ---- GET /ci/installations -------------------------------------------------

  app.get(
    '/ci/installations',
    { schema: { querystring: CiInstallationsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { agent_id } = req.query;
      if (!agent_id) {
        // Return empty array when no agent_id provided — installations are agent-scoped.
        return [];
      }
      return service.listInstallations(workspaceId, agent_id);
    },
  );

  // ---- GET /ci/performance ----------------------------------------------------
  // Agent Performance dashboard (AC-U1, AC-E1). `window` defaults to '30' and is
  // rejected with 422 when present but out of the {7,30,90} allow-list (AC-UN1,
  // AC-O3) — Zod schema validation handles both via the app's error handler.

  app.get(
    '/ci/performance',
    { schema: { querystring: CiPerformanceQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { window } = req.query;
      return service.getPerformance(workspaceId, window);
    },
  );

  // ---- DELETE /ci/installations/:id -------------------------------------------
  // Removes only the installation row; ci_runs are preserved (AC-E5).

  app.delete(
    '/ci/installations/:id',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.removeInstallation(req.params.id, workspaceId);
      return reply.status(204).send();
    },
  );

  // ---- POST /agents/:id/export-ci --------------------------------------------

  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: ExportBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.exportCi(workspaceId, req.params.id, req.body);
      reply.status(201);
      return result;
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison to mitigate timing-based token guessing.
 *
 * JavaScript doesn't have `crypto.timingSafeEqual` for strings natively;
 * we convert to buffers and use the Node.js built-in.
 */
function timingSafeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    const maxLen = Math.max(bufA.length, bufB.length);
    // Pad both to equal length so nodeTse always runs the same work,
    // preventing length leakage via timing.
    const paddedA = Buffer.alloc(maxLen);
    const paddedB = Buffer.alloc(maxLen);
    bufA.copy(paddedA);
    bufB.copy(paddedB);
    const equal = nodeTse(paddedA, paddedB);
    // Even if byte content matches after padding, different original lengths → false.
    return equal && bufA.length === bufB.length;
  } catch {
    return false;
  }
}
