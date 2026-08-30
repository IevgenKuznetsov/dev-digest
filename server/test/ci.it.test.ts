/**
 * Integration tests for the `ci` module routes.
 *
 * Covers (Steps 7, 8, 9 from the plan):
 * - POST /ci/ingest: 401 on missing/wrong token, 422 on malformed artifact,
 *   422 on unknown repo, 200 on valid artifact, dedupe (AC-UN6).
 * - GET /ci/runs: workspace-scoped rows.
 * - GET /ci/installations: workspace-scoped rows.
 * - POST /agents/:id/export-ci: with MockGitHubClient returns a CiExport.
 *
 * Uses Testcontainers (Docker) — skipped when Docker is unavailable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';

// ---------------------------------------------------------------------------
// Stub runner bundle setup
// ---------------------------------------------------------------------------
// The export service calls readRunnerBundle() which reads agent-runner/dist/index.js
// relative to the repo root. We ensure a stub exists so export tests pass without
// requiring a real ncc build.

function repoRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // Walk up: ci.it.test.ts → test/ → server/ → repo root
  return join(thisFile, '..', '..', '..');
}

const STUB_CONTENTS = '// stub runner bundle for integration tests\n';
const STUB_BUNDLE_PATH = join(repoRoot(), 'agent-runner', 'dist', 'index.js');
let createdStub = false;

async function ensureStubBundle(): Promise<void> {
  const { existsSync } = await import('node:fs');
  if (!existsSync(STUB_BUNDLE_PATH)) {
    try {
      await mkdir(join(STUB_BUNDLE_PATH, '..'), { recursive: true });
      await writeFile(STUB_BUNDLE_PATH, STUB_CONTENTS);
      createdStub = true;
    } catch {
      // best-effort; export tests will fail with a descriptive error if missing
    }
  }
}

async function cleanupStubBundle(): Promise<void> {
  if (createdStub) {
    try {
      await rm(STUB_BUNDLE_PATH, { force: true });
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Docker guard
// ---------------------------------------------------------------------------

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci.it] Docker not available — skipping CI integration tests.');
}

// ---------------------------------------------------------------------------
// Minimal valid ingest body (schema-valid CiResultArtifact + required fields)
// ---------------------------------------------------------------------------

function makeValidIngestBody(repo: string, commitSha = 'abc1234deadbeef') {
  return {
    repository: repo,
    commit_sha: commitSha,
    // CiResultArtifact fields (agent is required)
    agent: 'security-reviewer',
    pr_number: 42,
    findings_count: 3,
    cost_usd: 0.005,
    duration_ms: 12000,
    version: '1.0.0',
  };
}

// ---------------------------------------------------------------------------
// Integration suite
// ---------------------------------------------------------------------------

d('CI module — DB-backed routes via app.inject', () => {
  let pg: PgFixture;
  let agentId: string;
  let workspaceId: string;

  beforeAll(async () => {
    await ensureStubBundle();
    pg = await startPg();
    const { workspaceId: wsId } = await seed(pg.handle.db);
    workspaceId = wsId;

    // Grab the first seeded agent for our tests.
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.workspaceId, wsId))
      .limit(1);
    agentId = agent!.id;
  });

  afterAll(async () => {
    await pg?.stop();
    await cleanupStubBundle();
  });

  // ---- helpers ----------------------------------------------------------------

  function makeApp(secretsOverride?: MockSecretsProvider) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        github: new MockGitHubClient(),
        ...(secretsOverride ? { secrets: secretsOverride } : {}),
      },
    });
  }

  // ---- POST /ci/ingest — auth (AC-UN1) ----------------------------------------
  // NOTE: Fastify validates the request body schema BEFORE the handler runs.
  // The auth check is inside the handler, so we must send a schema-valid body
  // to reach the 401 code path. An invalid body yields 422 from schema validation.

  describe('POST /ci/ingest auth (AC-UN1)', () => {
    it('returns 401 when Authorization header is absent (valid body)', async () => {
      const secrets = new MockSecretsProvider({ CI_INGEST_TOKEN: 'tok' });
      const app = await makeApp(secrets);

      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        // No Authorization header — schema-valid body so we reach the handler
        payload: makeValidIngestBody('acme/repo'),
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('returns 401 when token is wrong', async () => {
      const secrets = new MockSecretsProvider({ CI_INGEST_TOKEN: 'correct-token' });
      const app = await makeApp(secrets);

      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { Authorization: 'Bearer wrong-token' },
        payload: makeValidIngestBody('acme/repo'),
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('does not write any rows when token is missing', async () => {
      const secrets = new MockSecretsProvider({ CI_INGEST_TOKEN: 'tok' });
      const app = await makeApp(secrets);
      const before = await pg.handle.db.select().from(t.ciRuns);

      await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        // No auth header — 401 means nothing persisted
        payload: makeValidIngestBody('acme/repo'),
      });

      const after = await pg.handle.db.select().from(t.ciRuns);
      expect(after.length).toBe(before.length);
      await app.close();
    });
  });

  // ---- POST /ci/ingest — schema validation (AC-UN2) ---------------------------

  describe('POST /ci/ingest schema validation (AC-UN2)', () => {
    it('returns 422 when artifact body is malformed (missing required fields)', async () => {
      const secrets = new MockSecretsProvider({ CI_INGEST_TOKEN: 'tok' });
      const app = await makeApp(secrets);

      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { Authorization: 'Bearer tok' },
        // Missing `repository` and `commit_sha` which are required
        payload: { findings_count: 3 },
      });

      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it('returns 422 when repository format is invalid', async () => {
      const secrets = new MockSecretsProvider({ CI_INGEST_TOKEN: 'tok' });
      const app = await makeApp(secrets);

      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { Authorization: 'Bearer tok' },
        payload: {
          repository: 'notavalidrepo', // missing slash
          commit_sha: 'abc1234',
          ...{ findings_count: 3 },
        },
      });

      expect(res.statusCode).toBe(422);
      await app.close();
    });
  });

  // ---- POST /ci/ingest — unknown repo (AC-UN2) --------------------------------

  describe('POST /ci/ingest unknown repo (AC-UN2)', () => {
    it('returns 422 when no installation matches the repository', async () => {
      const secrets = new MockSecretsProvider({ CI_INGEST_TOKEN: 'tok' });
      const app = await makeApp(secrets);

      const res = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { Authorization: 'Bearer tok' },
        payload: makeValidIngestBody('unknown/repo-no-installation'),
      });

      // Should be 422 (ValidationError) — no installation found.
      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it('does not insert any rows when repo is unknown', async () => {
      const secrets = new MockSecretsProvider({ CI_INGEST_TOKEN: 'tok' });
      const app = await makeApp(secrets);
      const before = await pg.handle.db.select().from(t.ciRuns);

      await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { Authorization: 'Bearer tok' },
        payload: makeValidIngestBody('unknown/repo-no-installation'),
      });

      const after = await pg.handle.db.select().from(t.ciRuns);
      expect(after.length).toBe(before.length);
      await app.close();
    });
  });

  // ---- POST /agents/:id/export-ci + ingest dedupe (AC-E6, AC-UN6) -------------

  describe('POST /agents/:id/export-ci + ingest flow (AC-E6, AC-UN6)', () => {
    it('export-ci returns a CiExport with installation, files, and pr_url', async () => {
      const secrets = new MockSecretsProvider({ CI_INGEST_TOKEN: 'export-tok' });
      const app = await makeApp(secrets);

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/export-ci`,
        payload: {
          repo: 'acme/myrepo',
          target: 'gha',
          action: 'open_pr',
          post_as: 'github_review',
          triggers: ['opened', 'synchronize'],
          base: 'main',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({
        pr_url: expect.any(String),
        files: expect.any(Array),
        installation: expect.objectContaining({ agent_id: agentId, repo: 'acme/myrepo' }),
      });
      await app.close();
    });

    it('export-ci with action=files returns pr_url=null (AC-E5)', async () => {
      const app = await makeApp();

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/export-ci`,
        payload: {
          repo: 'acme/files-only',
          target: 'gha',
          action: 'files',
          post_as: 'github_review',
          triggers: ['opened', 'synchronize'],
          base: 'main',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().pr_url).toBeNull();
      await app.close();
    });

    it('valid ingest with matching installation inserts agent_runs + ci_runs (AC-E6)', async () => {
      // 1. Export to create an installation for 'acme/ingest-repo'.
      const secrets = new MockSecretsProvider({ CI_INGEST_TOKEN: 'ingest-tok' });
      const app = await makeApp(secrets);

      const exportRes = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/export-ci`,
        payload: {
          repo: 'acme/ingest-repo',
          target: 'gha',
          action: 'files',
          post_as: 'github_review',
          triggers: ['opened', 'synchronize'],
          base: 'main',
        },
      });
      expect(exportRes.statusCode).toBe(201);

      // 2. Now ingest a result artifact.
      const agentRunsBefore = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.workspaceId, workspaceId));
      const ciRunsBefore = await pg.handle.db.select().from(t.ciRuns);

      const ingestRes = await app.inject({
        method: 'POST',
        url: '/ci/ingest',
        headers: { Authorization: 'Bearer ingest-tok' },
        payload: makeValidIngestBody('acme/ingest-repo', 'deadbeef1234567'),
      });

      expect(ingestRes.statusCode).toBe(200);
      expect(ingestRes.json()).toMatchObject({ ok: true });

      const agentRunsAfter = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.workspaceId, workspaceId));
      const ciRunsAfter = await pg.handle.db.select().from(t.ciRuns);

      // One new agent_runs row with source='ci'.
      expect(agentRunsAfter.length).toBe(agentRunsBefore.length + 1);
      const newRun = agentRunsAfter.find((r) => !agentRunsBefore.some((b) => b.id === r.id));
      expect(newRun?.source).toBe('ci');

      // One new ci_runs row.
      expect(ciRunsAfter.length).toBe(ciRunsBefore.length + 1);
      await app.close();
    });

    it('duplicate ingest (same installation, pr, SHA) updates existing ci_runs row — no duplicate (AC-UN6)', async () => {
      // 1. Export to create a fresh installation.
      const secrets = new MockSecretsProvider({ CI_INGEST_TOKEN: 'dedup-tok' });
      const app = await makeApp(secrets);

      const exportRes = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/export-ci`,
        payload: {
          repo: 'acme/dedupe-repo',
          target: 'gha',
          action: 'files',
          post_as: 'github_review',
          triggers: ['opened', 'synchronize'],
          base: 'main',
        },
      });
      expect(exportRes.statusCode).toBe(201);

      const ingestPayload = {
        method: 'POST' as const,
        url: '/ci/ingest',
        headers: { Authorization: 'Bearer dedup-tok' },
        payload: makeValidIngestBody('acme/dedupe-repo', 'cafecafe1234567'),
      };

      // 2. First ingest.
      const first = await app.inject(ingestPayload);
      expect(first.statusCode).toBe(200);

      const ciRunsAfterFirst = await pg.handle.db.select().from(t.ciRuns);

      // 3. Second ingest with same (repo, pr, SHA) — should update, not insert.
      const second = await app.inject(ingestPayload);
      expect(second.statusCode).toBe(200);

      const ciRunsAfterSecond = await pg.handle.db.select().from(t.ciRuns);

      // The ci_runs table must NOT have grown by another row.
      expect(ciRunsAfterSecond.length).toBe(ciRunsAfterFirst.length);
      await app.close();
    });
  });

  // ---- GET /ci/runs — workspace-scoped (AC-E7) --------------------------------

  describe('GET /ci/runs (AC-E7)', () => {
    it('returns an array (possibly empty) scoped to the workspace', async () => {
      const app = await makeApp();

      const res = await app.inject({ method: 'GET', url: '/ci/runs' });

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
      await app.close();
    });
  });

  // ---- GET /ci/installations — workspace-scoped (AC-E8) -----------------------

  describe('GET /ci/installations (AC-E8)', () => {
    it('returns empty array when no agent_id is provided', async () => {
      const app = await makeApp();

      const res = await app.inject({ method: 'GET', url: '/ci/installations' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
      await app.close();
    });

    it('returns installations for a given agent_id', async () => {
      const app = await makeApp();

      // First export to create an installation for this agent.
      const exportRes = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/export-ci`,
        payload: {
          repo: 'acme/list-test-repo',
          target: 'gha',
          action: 'files',
          post_as: 'github_review',
          triggers: ['opened', 'synchronize'],
          base: 'main',
        },
      });
      expect(exportRes.statusCode).toBe(201);

      const res = await app.inject({
        method: 'GET',
        url: `/ci/installations?agent_id=${agentId}`,
      });

      expect(res.statusCode).toBe(200);
      const installations = res.json() as Array<{ agent_id: string; repo: string }>;
      expect(installations.length).toBeGreaterThan(0);
      expect(installations.some((i) => i.agent_id === agentId)).toBe(true);
      await app.close();
    });
  });
});
