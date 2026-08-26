/**
 * Unit tests for CiService.exportCi (Step 5).
 *
 * All tests are pure in-memory — no DB, no network, no Docker.
 * Uses ContainerOverrides + MockGitHubClient from adapters/mocks.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { MockGitHubClient } from '../../adapters/mocks.js';
import type { Container } from '../../platform/container.js';
import { CiService } from './service.js';
import { CI_BRANCH, WORKFLOW_PATH, MANIFEST_DIR, SKILLS_DIR, RUNNER_PATH } from './constants.js';

// ---------------------------------------------------------------------------
// Minimal fixture factories
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'My Review Agent',
    description: '',
    provider: 'openrouter',
    model: 'openai/gpt-4o',
    systemPrompt: 'You are a helpful reviewer.',
    outputSchema: null,
    strategy: 'auto',
    ciFailOn: 'critical',
    repoIntel: true,
    enabled: true,
    version: 3,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSkillRow(name: string, body: string) {
  return {
    skill: {
      id: `skill-${name}`,
      workspaceId: 'ws-1',
      name,
      description: '',
      type: 'rubric' as const,
      source: 'manual' as const,
      body,
      enabled: true,
      version: 1,
      evidenceFiles: null,
      createdAt: new Date(),
    },
    order: 0,
  };
}

const MOCK_RUNNER = '// bundled runner placeholder';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeContainer(overrides: {
  github?: MockGitHubClient;
  agent?: ReturnType<typeof makeAgent> | null;
  skills?: ReturnType<typeof makeSkillRow>[];
}) {
  const agent = overrides.agent !== undefined ? overrides.agent : makeAgent();
  const skills = overrides.skills ?? [];
  const githubClient = overrides.github ?? new MockGitHubClient();

  return {
    agentsRepo: {
      getById: vi.fn().mockResolvedValue(agent),
      linkedSkills: vi.fn().mockResolvedValue(skills),
    },
    github: vi.fn().mockResolvedValue(githubClient),
  } as unknown as Container;
}

// Mock the readRunnerBundle helper so we don't need the actual built bundle.
vi.mock('./helpers.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./helpers.js')>();
  return {
    ...original,
    // Use a literal — vi.mock factory is hoisted before variable declarations.
    readRunnerBundle: vi.fn().mockReturnValue('// bundled runner placeholder'),
  };
});

// Mock the repository (we don't need DB in unit tests).
vi.mock('./repository.js', () => {
  return {
    CiRepository: vi.fn().mockImplementation(() => ({
      insertInstallation: vi.fn().mockResolvedValue({
        id: 'install-1',
        agentId: 'agent-1',
        repo: 'acme/myrepo',
        targetType: 'gha',
        agentVersion: 3,
        installedAt: new Date(),
      }),
      listInstallations: vi.fn().mockResolvedValue([]),
      findInstallationByRepo: vi.fn().mockResolvedValue(undefined),
      listRuns: vi.fn().mockResolvedValue([]),
      insertAgentRun: vi.fn().mockResolvedValue({}),
      upsertCiRun: vi.fn().mockResolvedValue({}),
      getWorkspaceIdForAgent: vi.fn().mockResolvedValue('ws-1'),
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultInput = {
  repo: 'acme/myrepo',
  target: 'gha' as const,
  action: 'open_pr' as const,
  post_as: 'github_review' as const,
  triggers: ['opened', 'synchronize'],
  base: 'main',
  workflow_override: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CiService.exportCi', () => {
  it('returns a CiExport with installation, files, and pr_url', async () => {
    const github = new MockGitHubClient();
    const container = makeContainer({ github });
    const service = new CiService(container);

    const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

    expect(result).toMatchObject({
      pr_url: expect.any(String),
      files: expect.any(Array),
      installation: expect.objectContaining({ agent_id: 'agent-1' }),
    });
  });

  describe('manifest validation (AC-U3, AC-UN7)', () => {
    it('manifest YAML parses back to the same AgentManifest shape', async () => {
      const container = makeContainer({});
      const service = new CiService(container);
      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      const manifestFile = result.files.find((f) => f.path.startsWith(MANIFEST_DIR));
      expect(manifestFile).toBeDefined();

      const parsed = parseYaml(manifestFile!.contents);
      const validated = AgentManifest.safeParse(parsed);
      expect(validated.success).toBe(true);
    });

    it('manifest contains the agent name and model', async () => {
      const container = makeContainer({});
      const service = new CiService(container);
      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      const manifestFile = result.files.find((f) => f.path.startsWith(MANIFEST_DIR));
      const parsed = parseYaml(manifestFile!.contents) as Record<string, unknown>;
      expect(parsed['name']).toBe('My Review Agent');
      expect(parsed['model']).toBe('openai/gpt-4o');
    });

    it('aborts with error when agent not found — no GitHub call made (AC-UN7)', async () => {
      const github = new MockGitHubClient();
      const container = makeContainer({ github, agent: null });
      const service = new CiService(container);

      await expect(service.exportCi('ws-1', 'agent-1', defaultInput)).rejects.toThrow('not found');
      expect(github.committed).toHaveLength(0);
      expect(github.openedPrs).toHaveLength(0);
    });
  });

  describe('secret safety (AC-U5)', () => {
    it('no emitted file contains OPENROUTER_API_KEY as a raw value', async () => {
      const container = makeContainer({});
      const service = new CiService(container);
      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      for (const file of result.files) {
        // The key name may appear only as a ${{ secrets.* }} reference in the workflow,
        // never as a bare assignment of a real secret value (which would be a non-$ char).
        const lines = file.contents.split('\n');
        for (const line of lines) {
          if (line.includes('OPENROUTER_API_KEY:') && !line.trim().startsWith('#')) {
            // Must be the secrets expression, never a raw credential.
            expect(line).toContain('${{ secrets.OPENROUTER_API_KEY }}');
          }
        }
      }
    });

    it('system_prompt is in manifest but not in workflow file', async () => {
      const container = makeContainer({});
      const service = new CiService(container);
      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      const workflowFile = result.files.find((f) => f.path === WORKFLOW_PATH);
      expect(workflowFile?.contents).not.toContain('You are a helpful reviewer');
    });
  });

  describe('commitFiles + openPullRequest args (AC-E4)', () => {
    it('calls commitFiles with branch devdigest/ci and correct base', async () => {
      const github = new MockGitHubClient();
      const container = makeContainer({ github });
      const service = new CiService(container);

      await service.exportCi('ws-1', 'agent-1', defaultInput);

      expect(github.committed).toHaveLength(1);
      expect(github.committed[0]?.branch).toBe(CI_BRANCH);
      expect(github.committed[0]?.base).toBe('main');
    });

    it('calls openPullRequest with head devdigest/ci', async () => {
      const github = new MockGitHubClient();
      const container = makeContainer({ github });
      const service = new CiService(container);

      await service.exportCi('ws-1', 'agent-1', defaultInput);

      expect(github.openedPrs).toHaveLength(1);
      expect(github.openedPrs[0]?.head).toBe(CI_BRANCH);
    });

    it('returns pr_url from opened PR', async () => {
      const github = new MockGitHubClient();
      const container = makeContainer({ github });
      const service = new CiService(container);

      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      expect(result.pr_url).toBe('https://github.com/mock/mock/pull/1');
    });
  });

  describe('findOpenPr reuse path (AC-E9)', () => {
    it('skips openPullRequest when a PR already exists on the branch', async () => {
      // Pre-seed the mock with an existing PR on CI_BRANCH.
      const github = new MockGitHubClient();
      // Push a fake PR so findOpenPr returns it.
      github.openedPrs.push({ title: 'existing', head: CI_BRANCH, base: 'main', body: '' });

      const container = makeContainer({ github });
      const service = new CiService(container);

      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      // commitFiles is still called (to update the branch).
      expect(github.committed).toHaveLength(1);
      // openPullRequest should NOT be called a second time.
      expect(github.openedPrs).toHaveLength(1); // still just the pre-seeded one
      expect(result.pr_url).toBe('https://github.com/mock/mock/pull/1');
    });
  });

  describe('action=files — no GitHub calls (AC-E5)', () => {
    it('returns files with pr_url=null for action=files', async () => {
      const github = new MockGitHubClient();
      const container = makeContainer({ github });
      const service = new CiService(container);

      const result = await service.exportCi('ws-1', 'agent-1', {
        ...defaultInput,
        action: 'files',
      });

      expect(result.pr_url).toBeNull();
      expect(github.committed).toHaveLength(0);
      expect(github.openedPrs).toHaveLength(0);
    });
  });

  describe('slug collision guard (AC-UN7)', () => {
    it('aborts before any GitHub call when two skills produce the same slug', async () => {
      const github = new MockGitHubClient();
      const container = makeContainer({
        github,
        skills: [
          makeSkillRow('My Skill', 'body 1'),
          makeSkillRow('my skill', 'body 2'), // same slug: "my-skill"
        ],
      });
      const service = new CiService(container);

      await expect(service.exportCi('ws-1', 'agent-1', defaultInput)).rejects.toThrow(
        'Slug collision',
      );
      expect(github.committed).toHaveLength(0);
    });
  });

  describe('file editable flags (AC-U8)', () => {
    it('workflow file is editable=true', async () => {
      const container = makeContainer({});
      const service = new CiService(container);
      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      const wf = result.files.find((f) => f.path === WORKFLOW_PATH);
      expect(wf?.editable).toBe(true);
    });

    it('manifest file is editable=false', async () => {
      const container = makeContainer({});
      const service = new CiService(container);
      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      const mf = result.files.find((f) => f.path.startsWith(MANIFEST_DIR));
      expect(mf?.editable).toBe(false);
    });

    it('runner file is editable=false', async () => {
      const container = makeContainer({});
      const service = new CiService(container);
      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      const rf = result.files.find((f) => f.path === RUNNER_PATH);
      expect(rf?.editable).toBe(false);
    });

    it('skill files are editable=false', async () => {
      const container = makeContainer({
        skills: [makeSkillRow('Security Review', '# Security Review\n')],
      });
      const service = new CiService(container);
      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      const sf = result.files.find((f) => f.path.startsWith(SKILLS_DIR));
      expect(sf?.editable).toBe(false);
    });
  });

  describe('workflow_override (AC-E3)', () => {
    it('uses workflow_override verbatim when provided', async () => {
      const container = makeContainer({});
      const service = new CiService(container);
      const customYaml = '# my custom workflow\nname: Custom\n';

      const result = await service.exportCi('ws-1', 'agent-1', {
        ...defaultInput,
        workflow_override: customYaml,
      });

      const wf = result.files.find((f) => f.path === WORKFLOW_PATH);
      expect(wf?.contents).toBe(customYaml);
    });
  });

  describe('skill files', () => {
    it('emits one skill file per linked skill with correct slug path', async () => {
      const container = makeContainer({
        skills: [makeSkillRow('Security Review', '# Security')],
      });
      const service = new CiService(container);
      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      const sf = result.files.find((f) => f.path === `${SKILLS_DIR}/security-review.md`);
      expect(sf).toBeDefined();
      expect(sf?.contents).toBe('# Security');
    });
  });
});
