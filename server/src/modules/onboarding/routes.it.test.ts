/**
 * Integration tests for the onboarding module routes.
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
import { ExternalServiceError } from '../../platform/errors.js';
import { TimeoutError } from '../../platform/resilience.js';
import { SECTION_ORDER } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function makeSections() {
  return SECTION_ORDER.map((kind) => ({
    kind,
    title: `Title ${kind}`,
    body: 'A body.',
    diagram: kind === 'architecture' ? 'flowchart LR\n  A --> B' : null,
    links: [],
  }));
}

d('onboarding routes (integration)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

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
        name: 'onboarding-test',
        fullName: 'acme/onboarding-test',
        defaultBranch: 'main',
      })
      .returning();
    repoId = repo!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function buildTestApp(llmOverride?: MockLLMProvider) {
    const mockLlm = llmOverride ?? new MockLLMProvider('openai', {
      structured: { sections: makeSections() },
    });
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { llm: { openai: mockLlm, anthropic: mockLlm, openrouter: mockLlm } },
    });
  }

  // ---- GET ----

  it('GET returns 404 when no onboarding exists', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // ---- POST success ----

  it('POST generates and returns the onboarding tour', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sections: unknown[]; model: string; generated_at: string; input_sha: null };
    expect(body.sections).toHaveLength(5);
    expect(body.model).toBeDefined();
    expect(body.generated_at).toBeDefined();
    await app.close();
  });

  it('GET returns 200 with tour after generation', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sections: unknown[] };
    expect(body.sections).toHaveLength(5);
    await app.close();
  });

  // ---- POST with language ----

  it('POST with valid language body succeeds', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ language: 'uk' }),
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('POST with invalid language returns 422', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ language: 'toolong123!' }),
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  // ---- POST returns 409 on concurrent generation ----

  it('POST returns 409 when generation is already in progress (AC-X2)', async () => {
    const concurrentLlm = new MockLLMProvider('openai');
    // Make the LLM hang forever so the lock stays held.
    (concurrentLlm as unknown as { completeStructured: unknown }).completeStructured = async () => {
      await new Promise(() => {}); // never resolves
    };

    const app = await buildTestApp(concurrentLlm);
    const [lockRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'lock-test', fullName: 'acme/lock-test' })
      .returning();
    const lockRepoId = lockRepo!.id;

    // Fire first request (will hang in LLM — don't await).
    const firstReqPromise = app.inject({ method: 'POST', url: `/repos/${lockRepoId}/onboarding` });

    // Give the first request time to acquire the lock.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Second request should get 409.
    const secondRes = await app.inject({ method: 'POST', url: `/repos/${lockRepoId}/onboarding` });
    expect(secondRes.statusCode).toBe(409);
    expect(secondRes.json()).toMatchObject({ error: { code: 'conflict' } });

    await app.close();
    // firstReqPromise will reject or resolve after app close — we don't care.
    await firstReqPromise.catch(() => {});
  });

  // ---- POST returns 500 on parse exhaustion ----

  it('POST returns 500 when LLM parse retries are exhausted (AC-X1)', async () => {
    const failLlm = new MockLLMProvider('openai');
    // Manually override completeStructured to throw parse-exhaustion error.
    (failLlm as unknown as { completeStructured: unknown }).completeStructured = async () => {
      throw new ExternalServiceError('OpenAI structured output failed schema validation', { raw: '{}' });
    };

    const app = await buildTestApp(failLlm);
    // Need a fresh repo to avoid lock conflict from previous test.
    const [freshRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'parse-fail-test', fullName: 'acme/parse-fail-test' })
      .returning();

    const res = await app.inject({ method: 'POST', url: `/repos/${freshRepo!.id}/onboarding` });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: 'parse_failure' } });
    await app.close();
  });

  // ---- POST returns 502 on network error ----

  it('POST returns 502 when LLM has a network error (AC-X7)', async () => {
    const networkLlm = new MockLLMProvider('openai');
    (networkLlm as unknown as { completeStructured: unknown }).completeStructured = async () => {
      throw new ExternalServiceError('OpenAI request failed: ECONNREFUSED');
    };

    const app = await buildTestApp(networkLlm);
    const [freshRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'network-fail-test', fullName: 'acme/network-fail-test' })
      .returning();

    const res = await app.inject({ method: 'POST', url: `/repos/${freshRepo!.id}/onboarding` });
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  // ---- POST returns 504 on timeout ----

  it('POST returns 504 when LLM times out (AC-X5)', async () => {
    const timeoutLlm = new MockLLMProvider('openai');
    (timeoutLlm as unknown as { completeStructured: unknown }).completeStructured = async () => {
      throw new TimeoutError(60_000);
    };

    const app = await buildTestApp(timeoutLlm);
    const [freshRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'timeout-test', fullName: 'acme/timeout-test' })
      .returning();

    const res = await app.inject({ method: 'POST', url: `/repos/${freshRepo!.id}/onboarding` });
    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({ error: { code: 'llm_timeout' } });
    await app.close();
  });

  // ---- 404 for unknown repo ----

  it('GET returns 404 for repo not in workspace', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/repos/00000000-0000-0000-0000-000000000000/onboarding`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
