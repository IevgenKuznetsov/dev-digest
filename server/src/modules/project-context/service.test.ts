/**
 * Unit tests for ProjectContextService.
 *
 * All DB / filesystem access is mocked — these tests run without Docker or a
 * real filesystem. They focus on the behaviours that live purely in the service:
 *   - resolveContextForAgent merge/dedup algorithm
 *   - MAX_ATTACHED_DOCS enforcement via SetContextBody schema
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock must be hoisted before imports that use the module.
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
  unlink: vi.fn(),
}));

import * as fsp from 'node:fs/promises';
import { ProjectContextService } from './service.js';
import type { Container } from '../../platform/container.js';
import type { ProjectContextRepository, ContextDocRow } from './repository.js';

// ====================================================== Helpers

/** Build a minimal fake ContextDocRow. */
function makeDoc(overrides: Partial<ContextDocRow> = {}): ContextDocRow {
  return {
    id: 'doc-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    path: 'specs/baseline.md',
    category: 'specs',
    tokens: 100,
    scannedAt: new Date('2025-01-01'),
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/** Build a minimal fake skill row with enabled = true. */
function makeSkill(id: string, enabled = true) {
  return {
    id,
    workspaceId: 'ws-1',
    name: `Skill ${id}`,
    description: '',
    prompt: '',
    enabled,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ====================================================== Mock wiring

/**
 * Build a ProjectContextService with all DB + repo calls mocked.
 * Returns `service` (the service under test) and `repo` (the mocked repo).
 */
function buildService() {
  // Minimal db stub: db.select() → from() → where() returns the rows we set.
  let dbRows: unknown[] = [{ id: 'repo-1', clonePath: '/clones/repo-1' }];

  const whereStub = vi.fn(() => Promise.resolve(dbRows));
  const fromStub = vi.fn(() => ({ where: whereStub }));
  const db = { select: vi.fn(() => ({ from: fromStub })) } as unknown as Container['db'];

  const container = { db, jobs: { register: vi.fn(), enqueue: vi.fn() } } as unknown as Container;

  const service = new ProjectContextService(container);

  // Replace the private repo with a vitest-mocked stub.
  const repo: Partial<ProjectContextRepository> = {
    getAgentDocsForMerge: vi.fn(),
    getEnabledSkillsForAgent: vi.fn(),
    getSkillDocsForMerge: vi.fn(),
    setAgentDocs: vi.fn(),
    setSkillDocs: vi.fn(),
    isScanRunning: vi.fn(),
    getById: vi.fn(),
    getAgentDocs: vi.fn(),
    countByRepo: vi.fn(),
  };

  // Inject via the private field name.
  Object.assign(service, { repo });

  const setClonePath = (clonePath: string | null) => {
    dbRows = [{ id: 'repo-1', clonePath }];
  };

  return { service, repo, setClonePath };
}

// ====================================================== resolveContextForAgent

describe('resolveContextForAgent — merge algorithm', () => {
  beforeEach(() => {
    vi.mocked(fsp.readFile).mockResolvedValue('# content' as never);
  });

  it('returns only agent docs when no enabled skills are linked', async () => {
    const { service, repo } = buildService();

    const doc = makeDoc({ path: 'specs/baseline.md' });
    vi.mocked(repo.getAgentDocsForMerge!).mockResolvedValue([doc]);
    vi.mocked(repo.getEnabledSkillsForAgent!).mockResolvedValue([]);

    const result = await service.resolveContextForAgent('agent-1', 'repo-1');

    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('specs/baseline.md');
    expect(result[0]!.category).toBe('specs');
  });

  it('appends skill docs after agent docs (skill-only case)', async () => {
    const { service, repo } = buildService();

    const skillDoc = makeDoc({ id: 'doc-s', path: 'docs/skill-readme.md', category: 'docs' });
    vi.mocked(repo.getAgentDocsForMerge!).mockResolvedValue([]);
    vi.mocked(repo.getEnabledSkillsForAgent!).mockResolvedValue([makeSkill('skill-1')]);
    vi.mocked(repo.getSkillDocsForMerge!).mockResolvedValue([skillDoc]);

    const result = await service.resolveContextForAgent('agent-1', 'repo-1');

    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('docs/skill-readme.md');
  });

  it('merges agent and skill docs with agent docs first', async () => {
    const { service, repo } = buildService();

    const agentDoc = makeDoc({ id: 'doc-a', path: 'specs/agent.md', category: 'specs' });
    const skillDoc = makeDoc({ id: 'doc-s', path: 'docs/skill.md', category: 'docs' });

    vi.mocked(repo.getAgentDocsForMerge!).mockResolvedValue([agentDoc]);
    vi.mocked(repo.getEnabledSkillsForAgent!).mockResolvedValue([makeSkill('skill-1')]);
    vi.mocked(repo.getSkillDocsForMerge!).mockResolvedValue([skillDoc]);

    const result = await service.resolveContextForAgent('agent-1', 'repo-1');

    expect(result).toHaveLength(2);
    expect(result[0]!.path).toBe('specs/agent.md');
    expect(result[1]!.path).toBe('docs/skill.md');
  });

  it('deduplicates by path — first occurrence (agent) wins', async () => {
    const { service, repo } = buildService();

    const sharedPath = 'specs/shared.md';
    const agentDoc = makeDoc({ id: 'doc-a', path: sharedPath });
    const skillDoc = makeDoc({ id: 'doc-s', path: sharedPath });

    vi.mocked(repo.getAgentDocsForMerge!).mockResolvedValue([agentDoc]);
    vi.mocked(repo.getEnabledSkillsForAgent!).mockResolvedValue([makeSkill('skill-1')]);
    vi.mocked(repo.getSkillDocsForMerge!).mockResolvedValue([skillDoc]);

    const result = await service.resolveContextForAgent('agent-1', 'repo-1');

    // Deduped to exactly 1 entry.
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe(sharedPath);
  });

  it('skips a file missing on disk, records tokens=0, and calls onWarning', async () => {
    const { service, repo } = buildService();

    const doc = makeDoc({ path: 'specs/missing.md' });
    vi.mocked(repo.getAgentDocsForMerge!).mockResolvedValue([doc]);
    vi.mocked(repo.getEnabledSkillsForAgent!).mockResolvedValue([]);

    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    vi.mocked(fsp.readFile).mockRejectedValue(enoent);

    const warnings: string[] = [];
    const result = await service.resolveContextForAgent('agent-1', 'repo-1', (msg) =>
      warnings.push(msg),
    );

    // Entry is still included with tokens=0 and empty content.
    expect(result).toHaveLength(1);
    expect(result[0]!.tokens).toBe(0);
    expect(result[0]!.content).toBe('');
    expect(warnings.some((w) => w.includes('missing'))).toBe(true);
  });

  it('returns [] and warns when clone directory is not available', async () => {
    const { service, repo, setClonePath } = buildService();

    const doc = makeDoc();
    vi.mocked(repo.getAgentDocsForMerge!).mockResolvedValue([doc]);
    vi.mocked(repo.getEnabledSkillsForAgent!).mockResolvedValue([]);
    setClonePath(null);

    const warnings: string[] = [];
    const result = await service.resolveContextForAgent('agent-1', 'repo-1', (msg) =>
      warnings.push(msg),
    );

    expect(result).toHaveLength(0);
    expect(warnings.some((w) => w.includes('clone directory'))).toBe(true);
  });
});

// ====================================================== SetContextBody — MAX_ATTACHED_DOCS

describe('SetContextBody (MAX_ATTACHED_DOCS = 10)', () => {
  it('rejects when more than 10 docs are submitted', async () => {
    const { SetContextBody, MAX_ATTACHED_DOCS } = await import('./helpers.js');

    const elevenDocs = Array.from({ length: MAX_ATTACHED_DOCS + 1 }, (_, i) => ({
      contextDocId: `00000000-0000-0000-0000-00000000${String(i).padStart(4, '0')}`,
      order: i,
    }));

    const result = SetContextBody.safeParse({ docs: elevenDocs });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 10 docs', async () => {
    const { SetContextBody, MAX_ATTACHED_DOCS } = await import('./helpers.js');

    const tenDocs = Array.from({ length: MAX_ATTACHED_DOCS }, (_, i) => ({
      contextDocId: `00000000-0000-0000-0000-00000000${String(i).padStart(4, '0')}`,
      order: i,
    }));

    const result = SetContextBody.safeParse({ docs: tenDocs });
    expect(result.success).toBe(true);
  });
});
