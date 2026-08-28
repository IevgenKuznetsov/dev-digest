/**
 * Integration tests for the multi-agent-review module routes.
 *
 * Needs Docker (Postgres via Testcontainers). Gate: dockerAvailable().
 * LLM is injected via ContainerOverrides (MockLLMProvider) — no real API calls.
 * Reviews are fire-and-forget in the service, so we verify DB state, not run completion.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('multi-agent-review routes (integration)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prId: string;
  let agentId1: string;
  let agentId2: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    // Insert a test repo.
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'multi-agent-test',
        fullName: 'acme/multi-agent-test',
        defaultBranch: 'main',
      })
      .returning();
    const repoId = repo!.id;

    // Insert a test PR.
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 42,
        title: 'Test PR for multi-agent review',
        author: 'testuser',
        branch: 'feature/multi-agent',
        base: 'main',
        headSha: 'deadbeef',
        additions: 20,
        deletions: 5,
        filesCount: 2,
        status: 'open',
      })
      .returning();
    prId = pr!.id;

    // Insert PR files so the review executor does not short-circuit.
    await pg.handle.db.insert(t.prFiles).values([
      { prId, path: 'src/index.ts', additions: 10, deletions: 2 },
      { prId, path: 'src/utils.ts', additions: 10, deletions: 3 },
    ]);

    // Insert two test agents belonging to the workspace.
    const [agent1] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Security Reviewer',
        description: 'Looks for security issues',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'You are a security reviewer.',
        enabled: true,
      })
      .returning();
    agentId1 = agent1!.id;

    const [agent2] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Performance Reviewer',
        description: 'Looks for performance issues',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'You are a performance reviewer.',
        enabled: true,
      })
      .returning();
    agentId2 = agent2!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function buildTestApp() {
    const mockLlm = new MockLLMProvider('openai', {
      structured: {
        verdict: 'changes_requested',
        score: 75,
        summary: 'Found some issues.',
        findings: [],
      },
    });
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { llm: { openai: mockLlm, anthropic: mockLlm, openrouter: mockLlm } },
    });
  }

  // ---- POST /pulls/:prId/multi-agent-run — success ----

  it('POST creates a multi-agent run and returns 201 with id and runs', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/multi-agent-run`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ agent_ids: [agentId1, agentId2] }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; runs: unknown[] };
    expect(body.id).toBeDefined();
    expect(body.runs).toHaveLength(2);

    // Verify multi_agent_runs row was created in DB
    const rows = await pg.handle.db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.id, body.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workspaceId).toBe(workspaceId);
    expect(rows[0]!.prId).toBe(prId);

    await app.close();
  });

  // ---- Verify agent_runs rows have multi_agent_run_id set ----

  it('POST sets multi_agent_run_id on agent_runs rows', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/multi-agent-run`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ agent_ids: [agentId1, agentId2] }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; runs: Array<{ run_id: string }> };

    // All agent_runs rows should have multi_agent_run_id = body.id
    for (const run of body.runs) {
      const agentRunRows = await pg.handle.db
        .select()
        .from(t.agentRuns)
        .where(eq(t.agentRuns.id, run.run_id));
      expect(agentRunRows).toHaveLength(1);
      expect(agentRunRows[0]!.multiAgentRunId).toBe(body.id);
    }

    await app.close();
  });

  // ---- GET /multi-agent-run/:id — success ----

  it('GET /multi-agent-run/:id returns 200 with columns and conflicts', async () => {
    const app = await buildTestApp();

    // First create a run
    const postRes = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/multi-agent-run`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ agent_ids: [agentId1] }),
    });
    expect(postRes.statusCode).toBe(201);
    const postBody = postRes.json() as { id: string };

    // Fetch the run
    const getRes = await app.inject({
      method: 'GET',
      url: `/multi-agent-run/${postBody.id}`,
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json() as {
      id: string;
      pr_id: string;
      columns: unknown[];
      conflicts: unknown[];
    };

    expect(getBody.id).toBe(postBody.id);
    expect(getBody.pr_id).toBe(prId);
    expect(Array.isArray(getBody.columns)).toBe(true);
    expect(Array.isArray(getBody.conflicts)).toBe(true);

    await app.close();
  });

  // ---- POST with empty agent_ids returns 400/422 ----

  it('POST with empty agent_ids returns 422 (Zod validation)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/multi-agent-run`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ agent_ids: [] }),
    });

    // Zod min(1) produces a 422 (Unprocessable Entity) from the route validator
    expect([400, 422]).toContain(res.statusCode);

    await app.close();
  });

  // ---- POST with non-existent agent ID returns 404 ----

  it('POST with non-existent agent_id returns 404', async () => {
    const app = await buildTestApp();
    const fakeAgentId = '00000000-0000-0000-0000-000000000099';
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/multi-agent-run`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ agent_ids: [fakeAgentId] }),
    });

    expect(res.statusCode).toBe(404);
    // NotFoundError base code is 'not_found'; specific code is in details
    const body = res.json() as { error: { code: string; details?: { code?: string } } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.details).toMatchObject({ code: 'agent_not_found' });

    await app.close();
  });

  // ---- GET with non-existent run ID returns 404 ----

  it('GET /multi-agent-run/:id returns 404 for non-existent ID', async () => {
    const app = await buildTestApp();
    const fakeRunId = '00000000-0000-0000-0000-000000000001';
    const res = await app.inject({
      method: 'GET',
      url: `/multi-agent-run/${fakeRunId}`,
    });

    expect(res.statusCode).toBe(404);

    await app.close();
  });

  // ---- POST with PR not in workspace returns 404 ----

  it('POST with non-existent prId returns 404', async () => {
    const app = await buildTestApp();
    const fakePrId = '00000000-0000-0000-0000-000000000002';
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${fakePrId}/multi-agent-run`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ agent_ids: [agentId1] }),
    });

    expect(res.statusCode).toBe(404);
    // NotFoundError base code is 'not_found'; specific code is in details
    const body = res.json() as { error: { code: string; details?: { code?: string } } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.details).toMatchObject({ code: 'pull_not_found' });

    await app.close();
  });

  // ---- GET /agents/estimates returns 200 ----

  it('GET /agents/estimates returns 200 with agents array', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/agents/estimates',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      agents: unknown[];
      total_cost_usd: number | null;
      total_duration_ms: number | null;
      is_partial: boolean;
    };
    expect(Array.isArray(body.agents)).toBe(true);
    expect(typeof body.is_partial).toBe('boolean');

    await app.close();
  });
});
