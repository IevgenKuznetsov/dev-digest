/**
 * Integration tests for OnboardingRepository.
 * Needs Docker (Postgres via Testcontainers). Gate: dockerAvailable().
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { seed } from '../../db/seed.js';
import { OnboardingRepository } from './repository.js';
import * as t from '../../db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('OnboardingRepository (integration)', () => {
  let pg: PgFixture;
  let repo: OnboardingRepository;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    // Insert a test repo row.
    const [repoRow] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'onboarding-test',
        fullName: 'acme/onboarding-test',
        defaultBranch: 'main',
      })
      .returning();
    repoId = repoRow!.id;

    repo = new OnboardingRepository(pg.handle.db);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('getByRepoId returns null when no row exists', async () => {
    const result = await repo.getByRepoId(repoId);
    expect(result).toBeNull();
  });

  it('upsert inserts a new row and getByRepoId retrieves it', async () => {
    const sections = [
      { kind: 'architecture', title: 'Arch', body: 'body', diagram: null, links: [] },
      { kind: 'critical_paths', title: 'Paths', body: 'body', diagram: null, links: [] },
      { kind: 'run_locally', title: 'Run', body: 'body', diagram: null, links: [] },
      { kind: 'reading_path', title: 'Read', body: 'body', diagram: null, links: [] },
      { kind: 'first_tasks', title: 'Tasks', body: 'body', diagram: null, links: [] },
    ];

    const upserted = await repo.upsert(repoId, {
      json: { sections },
      model: 'deepseek/deepseek-v4-flash',
      inputSha: 'abc123',
    });

    expect(upserted.repoId).toBe(repoId);
    expect(upserted.model).toBe('deepseek/deepseek-v4-flash');
    expect(upserted.inputSha).toBe('abc123');
    expect(upserted.generatedAt).toBeInstanceOf(Date);

    const fetched = await repo.getByRepoId(repoId);
    expect(fetched).not.toBeNull();
    expect(fetched!.repoId).toBe(repoId);
    expect(fetched!.model).toBe('deepseek/deepseek-v4-flash');
    expect(fetched!.inputSha).toBe('abc123');
    const jsonData = fetched!.json as { sections: unknown[] };
    expect(jsonData.sections).toHaveLength(5);
  });

  it('upsert updates the row on second call (upsert semantics)', async () => {
    await repo.upsert(repoId, {
      json: { sections: [] },
      model: 'gpt-4.1',
      inputSha: 'newsha456',
    });

    const fetched = await repo.getByRepoId(repoId);
    expect(fetched!.model).toBe('gpt-4.1');
    expect(fetched!.inputSha).toBe('newsha456');
  });

  it('upsert accepts null inputSha', async () => {
    await repo.upsert(repoId, {
      json: { sections: [] },
      model: 'deepseek/deepseek-v4-flash',
      inputSha: null,
    });

    const fetched = await repo.getByRepoId(repoId);
    expect(fetched!.inputSha).toBeNull();
  });

  it('getRepoForWorkspace returns repo when workspace matches', async () => {
    const row = await repo.getRepoForWorkspace(workspaceId, repoId);
    expect(row).not.toBeNull();
    expect(row!.id).toBe(repoId);
    expect(row!.workspaceId).toBe(workspaceId);
    expect(row!.owner).toBe('acme');
  });

  it('getRepoForWorkspace returns null for unknown repo', async () => {
    const row = await repo.getRepoForWorkspace(workspaceId, '00000000-0000-0000-0000-000000000000');
    expect(row).toBeNull();
  });

  it('getFileFacts returns [] when files array is empty', async () => {
    const facts = await repo.getFileFacts(repoId, []);
    expect(facts).toEqual([]);
  });

  it('getFileFacts returns [] when no matching file_facts rows exist', async () => {
    const facts = await repo.getFileFacts(repoId, ['src/index.ts', 'src/app.ts']);
    expect(facts).toEqual([]);
  });

  it('getFileFacts returns the row when a matching file_facts entry exists', async () => {
    // Insert a file_facts row for the test repo.
    await pg.handle.db.insert(t.fileFacts).values({
      repoId,
      filePath: 'src/server.ts',
      endpoints: ['/api/health', '/api/repos'],
      crons: [],
    });

    const facts = await repo.getFileFacts(repoId, ['src/server.ts', 'src/other.ts']);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.filePath).toBe('src/server.ts');
    expect(facts[0]!.endpoints).toEqual(['/api/health', '/api/repos']);
    expect(facts[0]!.crons).toEqual([]);
  });
});
