/**
 * Smart Diff route — GET /pulls/:id/smart-diff.
 * Integration test: spins up a real Postgres (Testcontainers), seeds a workspace +
 * repo + PR + pr_files, then asserts the classification + finding_lines + totals.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockGitHubClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

async function setupPrWithFiles(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  files: { path: string; additions: number; deletions: number }[],
) {
  const name = `smart-diff-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();

  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Test PR for Smart Diff',
      author: 'tester',
      branch: 'feat/smart-diff',
      base: 'main',
      headSha: 'abc123',
      additions: files.reduce((s, f) => s + f.additions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
      filesCount: files.length,
      status: 'open',
    })
    .returning();

  await db.insert(t.prFiles).values(files.map((f) => ({ prId: pr!.id, ...f })));

  return { repo: repo!, pr: pr! };
}

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('classifies files into correct roles and returns groups in core → wiring → boilerplate order', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });
    const { pr } = await setupPrWithFiles(pg.handle.db, workspaceId, [
      { path: 'src/app.ts', additions: 50, deletions: 10 },
      { path: 'package-lock.json', additions: 200, deletions: 100 },
      { path: 'src/index.ts', additions: 3, deletions: 1 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);

    const body = res.json() as SmartDiff;
    expect(body.groups).toBeDefined();

    const roles = body.groups.map((g) => g.role);
    // Groups must be ordered: core → wiring → boilerplate
    const coreIdx = roles.indexOf('core');
    const wiringIdx = roles.indexOf('wiring');
    const boilerplateIdx = roles.indexOf('boilerplate');
    expect(coreIdx).toBeLessThan(wiringIdx);
    expect(wiringIdx).toBeLessThan(boilerplateIdx);

    // src/app.ts → core
    const coreFiles = body.groups.find((g) => g.role === 'core')!.files.map((f) => f.path);
    expect(coreFiles).toContain('src/app.ts');

    // src/index.ts → wiring
    const wiringFiles = body.groups.find((g) => g.role === 'wiring')!.files.map((f) => f.path);
    expect(wiringFiles).toContain('src/index.ts');

    // package-lock.json → boilerplate
    const boilerplateFiles = body.groups
      .find((g) => g.role === 'boilerplate')!
      .files.map((f) => f.path);
    expect(boilerplateFiles).toContain('package-lock.json');

    await app.close();
  });

  it('returns finding_lines populated from the latest review', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });
    const { pr } = await setupPrWithFiles(pg.handle.db, workspaceId, [
      { path: 'src/auth.ts', additions: 30, deletions: 5 },
    ]);

    // Insert a review + findings for this PR
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        kind: 'review',
        verdict: 'needs_work',
        summary: 'Found issues',
        score: 60,
      })
      .returning();

    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/auth.ts',
        startLine: 15,
        endLine: 15,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Token exposed',
        rationale: 'Token is logged.',
        suggestion: 'Remove log.',
        confidence: 0.9,
        kind: 'finding',
      },
      {
        reviewId: review!.id,
        file: 'src/auth.ts',
        startLine: 42,
        endLine: 42,
        severity: 'WARNING',
        category: 'security',
        title: 'No rate limit',
        rationale: 'Auth endpoint has no rate limit.',
        suggestion: 'Add rate limit middleware.',
        confidence: 0.8,
        kind: 'finding',
      },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);

    const body = res.json() as SmartDiff;
    const authFile = body.groups
      .flatMap((g) => g.files)
      .find((f) => f.path === 'src/auth.ts');

    expect(authFile).toBeDefined();
    expect(authFile!.finding_lines).toContain(15);
    expect(authFile!.finding_lines).toContain(42);
    expect(authFile!.finding_lines).toHaveLength(2);

    await app.close();
  });

  it('computes split_suggestion.total_lines as sum of additions + deletions', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });
    const files = [
      { path: 'src/a.ts', additions: 100, deletions: 50 },
      { path: 'src/b.ts', additions: 80, deletions: 20 },
    ];
    const { pr } = await setupPrWithFiles(pg.handle.db, workspaceId, files);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);

    const body = res.json() as SmartDiff;
    const expectedTotal = files.reduce((s, f) => s + f.additions + f.deletions, 0);
    expect(body.split_suggestion.total_lines).toBe(expectedTotal);
    // 250 < 500 threshold
    expect(body.split_suggestion.too_big).toBe(false);

    await app.close();
  });

  it('returns 404 when the PR does not exist', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const res = await app.inject({ method: 'GET', url: `/pulls/${fakeId}/smart-diff` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
