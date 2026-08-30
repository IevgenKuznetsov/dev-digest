/**
 * Integration tests for GET /ci/performance (Agent Performance dashboard, v2).
 *
 * Needs Docker (Postgres via Testcontainers). Gate: dockerAvailable().
 * Exercises the real repository aggregation SQL (GROUP BY, windowed joins) —
 * unit tests only cover the pure shaping helpers (helpers.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DAY_MS = 24 * 60 * 60 * 1000;

d('GET /ci/performance (integration)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;
  let agentWithNoReviewsId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Perf Agent',
        provider: 'openrouter',
        model: 'openai/gpt-4o',
        systemPrompt: 'You are a reviewer.',
      })
      .returning();
    agentId = agent!.id;

    const [agentNoReviews] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'No-Findings Agent',
        provider: 'openrouter',
        model: 'openai/gpt-4o',
        systemPrompt: 'You are a reviewer.',
      })
      .returning();
    agentWithNoReviewsId = agentNoReviews!.id;

    // ---- agent_runs across windows (current 30d window vs previous 30d) ----
    const now = new Date();
    await pg.handle.db.insert(t.agentRuns).values([
      {
        workspaceId,
        agentId,
        agentName: 'Perf Agent',
        ranAt: new Date(now.getTime() - 5 * DAY_MS),
        costUsd: 10,
        durationMs: 1000,
        model: 'openai/gpt-4o',
        source: 'local',
        findingsCount: 2,
      },
      {
        workspaceId,
        agentId,
        agentName: 'Perf Agent',
        ranAt: new Date(now.getTime() - 2 * DAY_MS),
        costUsd: 5,
        durationMs: 2000,
        model: 'openai/gpt-4o',
        source: 'ci',
        findingsCount: 1,
      },
      // No-findings agent also ran in-window but has no reviews/findings —
      // its accept_rate must be null, never a fabricated 0 (AC-UN8).
      {
        workspaceId,
        agentId: agentWithNoReviewsId,
        agentName: 'No-Findings Agent',
        ranAt: new Date(now.getTime() - 3 * DAY_MS),
        costUsd: 3,
        durationMs: 500,
        model: 'openai/gpt-4o',
        source: 'local',
        findingsCount: 0,
      },
      // Previous window (31-45 days ago) — feeds cost_delta_usd.
      {
        workspaceId,
        agentId,
        agentName: 'Perf Agent',
        ranAt: new Date(now.getTime() - 35 * DAY_MS),
        costUsd: 4,
        durationMs: 1500,
        model: 'openai/gpt-4o',
        source: 'local',
        findingsCount: 1,
      },
    ]);

    // ---- reviews + findings (drives accept_rate for `agentId` only) ----
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'perf-test',
        fullName: 'acme/perf-test',
        defaultBranch: 'main',
      })
      .returning();

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Test PR',
        author: 'someone',
        branch: 'feat/x',
        base: 'main',
        headSha: 'abc1234',
      })
      .returning();

    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId,
        kind: 'review',
        createdAt: new Date(now.getTime() - 4 * DAY_MS),
      })
      .returning();

    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/x.ts',
        startLine: 1,
        endLine: 2,
        severity: 'warning',
        category: 'style',
        title: 'Finding 1',
        rationale: 'r',
        confidence: 0.8,
        acceptedAt: new Date(now.getTime() - 4 * DAY_MS),
      },
      {
        reviewId: review!.id,
        file: 'src/y.ts',
        startLine: 3,
        endLine: 4,
        severity: 'warning',
        category: 'style',
        title: 'Finding 2',
        rationale: 'r',
        confidence: 0.8,
        dismissedAt: new Date(now.getTime() - 4 * DAY_MS),
      },
    ]);

    // ---- a second workspace with its own agent_runs, for isolation ----
    const otherSeed = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-workspace-perf' })
      .returning();
    otherWorkspaceId = otherSeed[0]!.id;
    const [otherAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWorkspaceId,
        name: 'Other Agent',
        provider: 'openrouter',
        model: 'openai/gpt-4o',
        systemPrompt: 'You are a reviewer.',
      })
      .returning();
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId: otherWorkspaceId,
      agentId: otherAgent!.id,
      agentName: 'Other Agent',
      ranAt: new Date(now.getTime() - 1 * DAY_MS),
      costUsd: 999,
      durationMs: 1,
      source: 'local',
      findingsCount: 0,
    });
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function buildTestApp() {
    return buildApp({ config, db: pg.handle.db, overrides: {} });
  }

  it('defaults to window=30 and returns totals, delta, and per-agent rows', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/ci/performance' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as {
      window: string;
      total_runs: number;
      total_cost_usd: number;
      cost_delta_usd: number | null;
      agents: Array<{ agent_id: string; accept_rate: number | null }>;
      cost_by_agent: Array<{ key: string; cost_usd: number }>;
      cost_by_model: Array<{ key: string; cost_usd: number }>;
    };

    expect(body.window).toBe('30');
    // 3 runs land inside the current 30-day window (Perf Agent x2, No-Findings x1).
    expect(body.total_runs).toBe(3);
    expect(body.total_cost_usd).toBe(18); // 10 + 5 + 3
    // Previous window total cost is 4 (the 35-day-old run) — delta = 18 - 4.
    expect(body.cost_delta_usd).toBe(14);

    const perfAgentRow = body.agents.find((a) => a.agent_id === agentId);
    expect(perfAgentRow).toBeDefined();
    expect(perfAgentRow?.accept_rate).toBe(0.5); // 1 accepted / (1 accepted + 1 dismissed)

    const noFindingsRow = body.agents.find((a) => a.agent_id === agentWithNoReviewsId);
    expect(noFindingsRow).toBeDefined();
    expect(noFindingsRow?.accept_rate).toBeNull(); // AC-UN8 — never a fabricated 0

    expect(body.cost_by_agent.length).toBeGreaterThan(0);
    expect(body.cost_by_model.length).toBeGreaterThan(0);

    await app.close();
  });

  it('accepts an explicit valid window value', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/ci/performance?window=7' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { window: string }).window).toBe('7');
    await app.close();
  });

  it('rejects an out-of-allow-list window with 4xx (AC-UN1)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/ci/performance?window=14' });
    expect([400, 422]).toContain(res.statusCode);
    await app.close();
  });

  it("never leaks another workspace's runs into the totals (workspace isolation)", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/ci/performance' });
    expect(res.statusCode).toBe(200);
    // The resolved (default-seeded) workspace's totals must not include the
    // other workspace's 999-cost run, even though it's in the same window.
    const body = res.json() as { total_cost_usd: number };
    expect(body.total_cost_usd).toBe(18);
    void otherWorkspaceId; // seeded above; asserted indirectly via the totals check
    await app.close();
  });
});
