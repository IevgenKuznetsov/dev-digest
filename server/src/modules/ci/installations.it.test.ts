/**
 * Integration tests for the `ci` module's installation lifecycle (v2):
 * export → install → list (extended shape) → remove, plus ingest-wiring
 * provisioning and the v1 ingest-auth regression checks (AC-UN5/AC-UN6).
 *
 * Needs Docker (Postgres via Testcontainers). Gate: dockerAvailable().
 * GitHub and CiProvisioner are injected via ContainerOverrides — no real
 * network calls.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { CiProvisioner } from './provisioner.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function makeExportInput(repo: string) {
  return {
    repo,
    target: 'gha' as const,
    action: 'open_pr' as const,
    post_as: 'github_review' as const,
    triggers: ['opened', 'synchronize'],
    base: 'main',
  };
}

function makeCiProvisioner(): CiProvisioner & {
  createOrUpdateActionsSecret: ReturnType<typeof vi.fn>;
  setActionsVariable: ReturnType<typeof vi.fn>;
} {
  return {
    createOrUpdateActionsSecret: vi.fn().mockResolvedValue(undefined),
    setActionsVariable: vi.fn().mockResolvedValue(undefined),
  };
}

d('ci module installation lifecycle + ingest-wiring (integration)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Install Agent',
        provider: 'openrouter',
        model: 'openai/gpt-4o',
        systemPrompt: 'You are a reviewer.',
      })
      .returning();
    agentId = agent!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function buildTestApp(opts: {
    github?: MockGitHubClient;
    ciProvisioner?: CiProvisioner;
    ingestToken?: string;
  } = {}) {
    const github = opts.github ?? new MockGitHubClient();
    const ciProvisioner = opts.ciProvisioner ?? makeCiProvisioner();
    const secrets = new MockSecretsProvider({
      CI_INGEST_TOKEN: 'ingestToken' in opts ? opts.ingestToken : 'fake-ci-ingest-token',
    });
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { github, ciProvisioner, secrets },
    });
  }

  // ---------------------------------------------------------------------
  // export → install → extended GET shape
  // ---------------------------------------------------------------------

  it('POST export-ci provisions the secret/variable and GET installations returns the extended shape', async () => {
    const github = new MockGitHubClient();
    const ciProvisioner = makeCiProvisioner();
    const app = await buildTestApp({ github, ciProvisioner });

    const exportRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: makeExportInput('acme/install-test'),
    });
    expect(exportRes.statusCode).toBe(201);
    const exportBody = exportRes.json() as {
      pr_url: string | null;
      ingest_wiring: { status: string };
    };
    expect(exportBody.pr_url).toBeDefined();
    expect(exportBody.ingest_wiring).toEqual({ status: 'ok' });

    // Provisioning was invoked with the right repo + secret/variable names (AC-E6).
    expect(ciProvisioner.createOrUpdateActionsSecret).toHaveBeenCalledWith(
      'acme',
      'install-test',
      'CI_INGEST_TOKEN',
      'fake-ci-ingest-token',
    );
    expect(ciProvisioner.setActionsVariable).toHaveBeenCalledWith(
      'acme',
      'install-test',
      'DEVDIGEST_STUDIO_URL',
      expect.any(String),
    );

    const listRes = await app.inject({
      method: 'GET',
      url: `/ci/installations?agent_id=${agentId}`,
    });
    expect(listRes.statusCode).toBe(200);
    const rows = listRes.json() as Array<{
      repo: string;
      agent_version: number | null;
      last_status: string | null;
      last_run_at: string | null;
    }>;
    const installed = rows.find((r) => r.repo === 'acme/install-test');
    expect(installed).toBeDefined();
    // Extended shape (AC-U5, AC-E3) — no ci_runs ingested yet, so both are null.
    expect(installed?.last_status).toBeNull();
    expect(installed?.last_run_at).toBeNull();
    expect('agent_version' in (installed ?? {})).toBe(true);

    await app.close();
  });

  it('pre-flight fails with a client error when CI_INGEST_TOKEN is not configured (AC-O2)', async () => {
    const app = await buildTestApp({ ingestToken: undefined });

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: makeExportInput('acme/no-token-test'),
    });
    expect(res.statusCode).toBe(422);

    // No installation row should exist for this repo — the pre-flight guard
    // runs before any GitHub call.
    const listRes = await app.inject({
      method: 'GET',
      url: `/ci/installations?agent_id=${agentId}`,
    });
    const rows = listRes.json() as Array<{ repo: string }>;
    expect(rows.some((r) => r.repo === 'acme/no-token-test')).toBe(false);

    await app.close();
  });

  it('surfaces ingest_wiring: incomplete (never a false ok) when provisioning fails, without discarding the opened PR (AC-UN2)', async () => {
    const github = new MockGitHubClient();
    const ciProvisioner = makeCiProvisioner();
    ciProvisioner.createOrUpdateActionsSecret.mockRejectedValueOnce(new Error('provisioning boom'));
    const app = await buildTestApp({ github, ciProvisioner });

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: makeExportInput('acme/provision-fail-test'),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { pr_url: string | null; ingest_wiring: { status: string; error?: string } };
    expect(body.pr_url).toBeTruthy();
    expect(body.ingest_wiring.status).toBe('incomplete');
    expect(body.ingest_wiring.error).toContain('provisioning boom');

    await app.close();
  });

  // ---------------------------------------------------------------------
  // AC-UN7 — Add repository for an already-installed repo updates, no dup row
  // ---------------------------------------------------------------------

  it('exporting the same (agent, repo) pair twice updates the row instead of duplicating it (AC-UN7)', async () => {
    const github = new MockGitHubClient();
    const app = await buildTestApp({ github });

    const repo = 'acme/dedup-test';
    const first = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: makeExportInput(repo),
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: makeExportInput(repo),
    });
    expect(second.statusCode).toBe(201);

    const listRes = await app.inject({
      method: 'GET',
      url: `/ci/installations?agent_id=${agentId}`,
    });
    const rows = (listRes.json() as Array<{ repo: string }>).filter((r) => r.repo === repo);
    expect(rows).toHaveLength(1);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // DELETE — removes only the installation row, preserves ci_runs (AC-E5)
  // ---------------------------------------------------------------------

  it('DELETE removes only the installation row; a prior ci_run is preserved with ci_installation_id set null', async () => {
    const github = new MockGitHubClient();
    const app = await buildTestApp({ github });
    const repo = 'acme/delete-test';

    const exportRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: makeExportInput(repo),
    });
    expect(exportRes.statusCode).toBe(201);
    const installationId = (
      exportRes.json() as { installation: { id: string } }
    ).installation.id;

    // Ingest one run against this installation via the real token-authed route.
    const ingestRes = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: 'Bearer fake-ci-ingest-token' },
      payload: {
        repository: repo,
        commit_sha: 'abc1234',
        version: '1',
        findings_count: 0,
        cost_usd: 0,
        agent: 'Install Agent',
      },
    });
    expect(ingestRes.statusCode).toBe(200);

    const [ciRunBefore] = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationId));
    expect(ciRunBefore).toBeDefined();

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/ci/installations/${installationId}`,
    });
    expect(delRes.statusCode).toBe(204);

    const listRes = await app.inject({
      method: 'GET',
      url: `/ci/installations?agent_id=${agentId}`,
    });
    const rows = (listRes.json() as Array<{ repo: string }>).filter((r) => r.repo === repo);
    expect(rows).toHaveLength(0);

    // The ci_run row itself must survive the delete — only the FK link is
    // severed (ON DELETE SET NULL), preserving historical CI data (AC-E5).
    const [ciRunAfter] = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.id, ciRunBefore!.id));
    expect(ciRunAfter).toBeDefined();
    expect(ciRunAfter?.ciInstallationId).toBeNull();

    await app.close();
  });

  // ---------------------------------------------------------------------
  // v1 regression — ingest 401 / unknown-repo 400 unchanged (AC-UN5/AC-UN6)
  // ---------------------------------------------------------------------

  it('POST /ci/ingest returns 401 with no or wrong bearer token (AC-UN5 regression)', async () => {
    const app = await buildTestApp();

    const noAuth = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      payload: {
        repository: 'acme/install-test',
        commit_sha: 'abc1234',
        version: '1',
        findings_count: 0,
        cost_usd: 0,
        agent: 'Install Agent',
      },
    });
    expect(noAuth.statusCode).toBe(401);

    const wrongAuth = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: 'Bearer wrong-token' },
      payload: {
        repository: 'acme/install-test',
        commit_sha: 'abc1234',
        version: '1',
        findings_count: 0,
        cost_usd: 0,
        agent: 'Install Agent',
      },
    });
    expect(wrongAuth.statusCode).toBe(401);

    await app.close();
  });

  it('POST /ci/ingest returns a client error for an unknown repository (AC-UN6 regression)', async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/ci/ingest',
      headers: { authorization: 'Bearer fake-ci-ingest-token' },
      payload: {
        repository: 'acme/never-installed',
        commit_sha: 'abc1234',
        version: '1',
        findings_count: 0,
        cost_usd: 0,
        agent: 'Install Agent',
      },
    });
    expect([400, 422]).toContain(res.statusCode);

    await app.close();
  });
});
