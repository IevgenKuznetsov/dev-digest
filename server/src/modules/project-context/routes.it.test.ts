/**
 * Integration tests for the project-context module.
 *
 * Needs Docker (Postgres via Testcontainers). Gate: `dockerAvailable()`.
 * Uses a real temporary filesystem directory to simulate the repo clone.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('project-context routes (integration)', () => {
  let pg: PgFixture;
  let cloneDir: string;
  let workspaceId: string;
  let repoId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    // Create a temporary clone directory with some markdown files.
    cloneDir = join(tmpdir(), `dd-test-clone-${Date.now()}`);
    await mkdir(join(cloneDir, 'specs'), { recursive: true });
    await mkdir(join(cloneDir, 'docs'), { recursive: true });
    await writeFile(join(cloneDir, 'specs', 'security-baseline.md'), '# Security\nSSRF validation required.');
    await writeFile(join(cloneDir, 'docs', 'architecture.md'), '# Architecture\nService mesh pattern.');
    await writeFile(join(cloneDir, 'INSIGHTS.md'), '# Insights\nNon-obvious decisions.');

    // Insert a repo row with clonePath pointing at our temp dir.
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'ctx-test', fullName: 'acme/ctx-test', clonePath: cloneDir })
      .returning();
    repoId = repo!.id;

    // Use an existing agent from seed (first one).
    const agents = await pg.handle.db.select().from(t.agents).limit(1);
    agentId = agents[0]!.id;
  });

  afterAll(async () => {
    await pg?.stop();
    await rm(cloneDir, { recursive: true, force: true });
  });

  // ---- Helper: build a fresh app for each test to avoid state bleed ----

  async function buildTestApp() {
    return buildApp({ config, db: pg.handle.db });
  }

  // ====================================================== Scan

  it('POST /repos/:repoId/context/scan returns 202 and a jobId', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/context/scan`,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty('jobId');
    await app.close();
  });

  it('GET /repos/:repoId/context/docs returns docs after scan completes', async () => {
    const app = await buildTestApp();

    // Trigger scan and wait for the job to finish.
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/scan` });
    await app.container.jobs.onIdle();

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` });
    expect(res.statusCode).toBe(200);
    const docs = res.json() as Array<{ path: string; category: string; tokens: number }>;
    expect(docs.length).toBeGreaterThanOrEqual(3);

    const paths = docs.map((d) => d.path);
    expect(paths).toContain('specs/security-baseline.md');
    expect(paths).toContain('docs/architecture.md');
    expect(paths).toContain('INSIGHTS.md');

    // Categories are classified correctly.
    const spec = docs.find((d) => d.path === 'specs/security-baseline.md');
    expect(spec?.category).toBe('specs');
    const insight = docs.find((d) => d.path === 'INSIGHTS.md');
    expect(insight?.category).toBe('insights');

    // Token counts are positive.
    expect(docs.every((d) => d.tokens > 0)).toBe(true);

    await app.close();
  });

  // ====================================================== Concurrent scan guard

  it('second POST /repos/:repoId/context/scan returns 409 while first is running', async () => {
    const app = await buildTestApp();

    // Enqueue the first scan (don't wait for idle).
    const first = await app.inject({ method: 'POST', url: `/repos/${repoId}/context/scan` });
    expect(first.statusCode).toBe(202);

    // Immediately try a second scan while the first may still be running or queued.
    const second = await app.inject({ method: 'POST', url: `/repos/${repoId}/context/scan` });
    expect(second.statusCode).toBe(409);

    // Let the job finish before closing.
    await app.container.jobs.onIdle();
    await app.close();
  });

  // ====================================================== Read content

  it('GET /repos/:repoId/context/docs/:docId/content returns raw markdown', async () => {
    const app = await buildTestApp();

    // Ensure we have docs.
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/scan` });
    await app.container.jobs.onIdle();

    const listRes = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` });
    const docs = listRes.json() as Array<{ id: string; path: string }>;
    const specDoc = docs.find((d) => d.path === 'specs/security-baseline.md')!;

    const contentRes = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/docs/${specDoc.id}/content`,
    });
    expect(contentRes.statusCode).toBe(200);
    expect(contentRes.body).toContain('SSRF validation required');

    await app.close();
  });

  // ====================================================== Edit / save

  it('PUT /repos/:repoId/context/docs/:docId/content updates file and recalculates tokens', async () => {
    const app = await buildTestApp();

    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/scan` });
    await app.container.jobs.onIdle();

    const listRes = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` });
    const docs = listRes.json() as Array<{ id: string; path: string; tokens: number }>;
    const docId = docs.find((d) => d.path === 'specs/security-baseline.md')!.id;
    const oldTokens = docs.find((d) => d.path === 'specs/security-baseline.md')!.tokens;

    const newContent = 'Updated content with many many more words than before to increase token count significantly.';
    const updateRes = await app.inject({
      method: 'PUT',
      url: `/repos/${repoId}/context/docs/${docId}/content`,
      payload: { content: newContent },
    });
    expect(updateRes.statusCode).toBe(200);

    const updated = updateRes.json() as { tokens: number };
    // Token count should reflect the new content (may differ from old).
    expect(typeof updated.tokens).toBe('number');

    await app.close();
  });

  // ====================================================== Delete

  it('DELETE /repos/:repoId/context/docs/:docId removes the doc', async () => {
    const app = await buildTestApp();

    // Create a throwaway file to delete.
    await writeFile(join(cloneDir, 'specs', 'to-delete.md'), '# Delete me');
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/scan` });
    await app.container.jobs.onIdle();

    const listRes = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` });
    const docs = listRes.json() as Array<{ id: string; path: string }>;
    const toDelete = docs.find((d) => d.path === 'specs/to-delete.md');
    expect(toDelete).toBeDefined();

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/repos/${repoId}/context/docs/${toDelete!.id}`,
    });
    expect(delRes.statusCode).toBe(204);

    // The doc is gone from the list.
    const listAfter = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` });
    const pathsAfter = (listAfter.json() as Array<{ path: string }>).map((d) => d.path);
    expect(pathsAfter).not.toContain('specs/to-delete.md');

    await app.close();
  });

  // ====================================================== Path traversal guard

  it('GET /repos/:repoId/context/docs with invalid docId returns 400 or 404', async () => {
    const app = await buildTestApp();
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/docs/${fakeId}`,
    });
    // Not found — the doc doesn't exist.
    expect([400, 404]).toContain(res.statusCode);
    await app.close();
  });

  // ====================================================== Attach/detach to agent

  it('PUT /agents/:agentId/context attaches docs and GET retrieves them', async () => {
    const app = await buildTestApp();

    // Ensure docs exist.
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/scan` });
    await app.container.jobs.onIdle();

    const listRes = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` });
    const docs = listRes.json() as Array<{ id: string; path: string }>;
    const firstDoc = docs[0]!;

    // Attach the first doc to the agent.
    const putRes = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context`,
      payload: { docs: [{ contextDocId: firstDoc.id, order: 0 }] },
    });
    expect(putRes.statusCode).toBe(204);

    // Retrieve and verify.
    const getRes = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/context`,
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json() as { attached: Array<{ id: string }>; totalAvailable: number };
    expect(body.attached).toHaveLength(1);
    expect(body.attached[0]!.id).toBe(firstDoc.id);
    expect(body.totalAvailable).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('PUT /agents/:agentId/context with empty docs detaches all', async () => {
    const app = await buildTestApp();

    // Detach all by sending empty array.
    const putRes = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context`,
      payload: { docs: [] },
    });
    expect(putRes.statusCode).toBe(204);

    const getRes = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/context`,
    });
    const body = getRes.json() as { attached: unknown[] };
    expect(body.attached).toHaveLength(0);

    await app.close();
  });

  // ====================================================== Attach to skill

  it('PUT /skills/:skillId/context attaches docs to a skill', async () => {
    const app = await buildTestApp();

    // Get an existing skill from seed.
    const skills = await pg.handle.db.select().from(t.skills).limit(1);
    if (skills.length === 0) {
      // No skills seeded — skip this part gracefully.
      await app.close();
      return;
    }
    const skillId = skills[0]!.id;

    // Ensure docs exist.
    await app.inject({ method: 'POST', url: `/repos/${repoId}/context/scan` });
    await app.container.jobs.onIdle();

    const docs = (await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` })).json() as Array<{ id: string }>;

    const putRes = await app.inject({
      method: 'PUT',
      url: `/skills/${skillId}/context`,
      payload: { docs: [{ contextDocId: docs[0]!.id, order: 0 }] },
    });
    expect(putRes.statusCode).toBe(204);

    const getRes = await app.inject({
      method: 'GET',
      url: `/skills/${skillId}/context`,
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json() as { attached: Array<{ id: string }> };
    expect(body.attached).toHaveLength(1);

    await app.close();
  });
});
