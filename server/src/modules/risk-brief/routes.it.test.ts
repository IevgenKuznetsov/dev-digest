/**
 * Integration tests for the risk-brief module routes.
 *
 * Needs Docker (Postgres via Testcontainers). Gate: dockerAvailable().
 * LLM is injected via ContainerOverrides (MockLLMProvider) — no real API calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { Brief } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function makeBrief(): Brief {
  return {
    what: 'Adds rate limiting to the auth endpoint',
    why: 'Prevents brute force attacks',
    risk_level: 'high',
    risks: [
      {
        title: 'Auth bypass risk',
        description: 'Could allow bypass if misconfigured',
        file_refs: [{ file: 'src/auth.ts', line: 42 }],
      },
    ],
    review_focus: [
      {
        file: 'src/auth.ts',
        line: 42,
        note: 'Check rate limit logic',
      },
    ],
  };
}

d('risk-brief routes (integration)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prId: string;

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
        name: 'risk-brief-test',
        fullName: 'acme/risk-brief-test',
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
        number: 1,
        title: 'Test PR',
        author: 'testuser',
        branch: 'feature/test',
        base: 'main',
        headSha: 'abc123',
        additions: 10,
        deletions: 5,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    prId = pr!.id;

    // Insert a PR file so the zero-files guard doesn't trigger.
    await pg.handle.db.insert(t.prFiles).values({
      prId,
      path: 'src/auth.ts',
      additions: 10,
      deletions: 5,
    });
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function buildTestApp(llmOverride?: MockLLMProvider) {
    const mockLlm = llmOverride ?? new MockLLMProvider('openai', {
      structured: makeBrief(),
    });
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { llm: { openai: mockLlm, anthropic: mockLlm, openrouter: mockLlm } },
    });
  }

  // ---- GET before generation ----

  it('GET returns 404 when no brief exists', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // ---- POST generates brief ----

  it('POST generates a brief and returns 200', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { brief: Brief; head_sha: string; model: string; generated_at: string };
    expect(body.brief).toBeDefined();
    expect(body.brief.what).toBe('Adds rate limiting to the auth endpoint');
    expect(body.head_sha).toBe('abc123');
    expect(body.model).toBeDefined();
    expect(body.generated_at).toBeDefined();
    // Verify generated_at is an ISO 8601 string (GAP-9)
    expect(new Date(body.generated_at).toISOString()).toBe(body.generated_at);
    await app.close();
  });

  // ---- GET after generation ----

  it('GET returns 200 with brief after generation', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { brief: Brief; head_sha: string };
    expect(body.brief).toBeDefined();
    expect(body.head_sha).toBe('abc123');
    await app.close();
  });

  // ---- POST while lock held returns 409 ----

  it('POST returns 409 when generation is already in progress (AC-X4)', { timeout: 15_000 }, async () => {
    // Insert a separate PR for the lock test.
    const [repo2] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'lock-test-brief', fullName: 'acme/lock-test-brief' })
      .returning();
    const [pr2] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo2!.id,
        number: 99,
        title: 'Lock Test PR',
        author: 'tester',
        branch: 'feature/lock',
        base: 'main',
        headSha: 'lock123',
        additions: 5,
        deletions: 2,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    const lockPrId = pr2!.id;
    await pg.handle.db.insert(t.prFiles).values({ prId: lockPrId, path: 'src/lock.ts', additions: 5, deletions: 2 });

    // Make the LLM hang briefly (2s) so the lock stays held long enough for the second request.
    const hangingLlm = new MockLLMProvider('openai');
    let resolveHang!: () => void;
    const hangPromise = new Promise<void>((res) => { resolveHang = res; });
    (hangingLlm as unknown as { completeStructured: () => Promise<never> }).completeStructured = async () => {
      await hangPromise;
      throw new Error('test aborted');
    };

    const app = await buildTestApp(hangingLlm);

    // Fire first request (will hang — don't await).
    const firstReqPromise = app.inject({ method: 'POST', url: `/pulls/${lockPrId}/brief` });

    // Give the first request time to acquire the lock.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Second request should get 409.
    const secondRes = await app.inject({ method: 'POST', url: `/pulls/${lockPrId}/brief` });
    expect(secondRes.statusCode).toBe(409);
    expect(secondRes.json()).toMatchObject({ error: { code: 'conflict' } });

    // Release the hang so the first request can finish.
    resolveHang();
    await firstReqPromise.catch(() => {});
    await app.close();
  });

  // ---- Zero-files PR returns 422 (EC-7) ----

  it('POST returns 422 for a PR with zero files (EC-7)', async () => {
    const [repo3] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'empty-pr-test', fullName: 'acme/empty-pr-test' })
      .returning();
    const [pr3] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo3!.id,
        number: 77,
        title: 'Empty PR',
        author: 'tester',
        branch: 'feature/empty',
        base: 'main',
        headSha: 'empty123',
        additions: 0,
        deletions: 0,
        filesCount: 0,
        status: 'open',
      })
      .returning();
    const emptyPrId = pr3!.id;
    // No files inserted!

    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: `/pulls/${emptyPrId}/brief` });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  // ---- Stale detection via head_sha ----

  it('GET response includes head_sha for client stale detection', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { head_sha: string };
    expect(body.head_sha).toBe('abc123'); // matches PR's head_sha
    await app.close();
  });
});
