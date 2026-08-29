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
import {
  CI_BRANCH,
  WORKFLOW_PATH,
  MANIFEST_DIR,
  SKILLS_DIR,
  RUNNER_PATH,
  DEFAULT_RUNNER_LABEL,
  DEFAULT_STUDIO_URL,
} from './constants.js';

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

function makeCiProvisioner() {
  return {
    createOrUpdateActionsSecret: vi.fn().mockResolvedValue(undefined),
    setActionsVariable: vi.fn().mockResolvedValue(undefined),
  };
}

function makeContainer(overrides: {
  github?: MockGitHubClient;
  agent?: ReturnType<typeof makeAgent> | null;
  skills?: ReturnType<typeof makeSkillRow>[];
  ingestToken?: string | undefined;
  ciProvisioner?: ReturnType<typeof makeCiProvisioner>;
}) {
  const agent = overrides.agent !== undefined ? overrides.agent : makeAgent();
  const skills = overrides.skills ?? [];
  const githubClient = overrides.github ?? new MockGitHubClient();
  const ingestToken = 'ingestToken' in overrides ? overrides.ingestToken : 'fake-ci-ingest-token';
  const ciProvisioner = overrides.ciProvisioner ?? makeCiProvisioner();

  return {
    agentsRepo: {
      getById: vi.fn().mockResolvedValue(agent),
      linkedSkills: vi.fn().mockResolvedValue(skills),
    },
    github: vi.fn().mockResolvedValue(githubClient),
    secrets: {
      get: vi.fn().mockResolvedValue(ingestToken),
    },
    ciProvisioner: vi.fn().mockResolvedValue(ciProvisioner),
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
      upsertInstallation: vi.fn().mockResolvedValue({
        id: 'install-1',
        agentId: 'agent-1',
        repo: 'acme/myrepo',
        targetType: 'gha',
        agentVersion: 3,
        installedAt: new Date(),
      }),
      listInstallations: vi.fn().mockResolvedValue([]),
      listInstallationsWithLatestRun: vi.fn().mockResolvedValue([]),
      deleteInstallation: vi.fn().mockResolvedValue(true),
      findInstallationByRepo: vi.fn().mockResolvedValue(undefined),
      listRuns: vi.fn().mockResolvedValue([]),
      insertAgentRun: vi.fn().mockResolvedValue({}),
      upsertCiRun: vi.fn().mockResolvedValue({}),
      getWorkspaceAndNameForAgent: vi
        .fn()
        .mockResolvedValue({ workspaceId: 'ws-1', agentName: 'Test Agent' }),
      totalsForWindow: vi.fn().mockResolvedValue({ totalRuns: 0, totalCostUsd: 0 }),
      aggregateAgentRuns: vi.fn().mockResolvedValue([]),
      acceptCountsByAgent: vi.fn().mockResolvedValue([]),
      costByModel: vi.fn().mockResolvedValue([]),
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
    // Minimal YAML that still satisfies validateWorkflowOverride's invariants
    // (explicit least-privilege permissions, self-hosted runs-on, fork guard,
    // no pull_request_target) — v2 security regression coverage.
    const compliantYaml = [
      '# my custom workflow',
      'name: Custom',
      'on:',
      '  pull_request:',
      '    types: [opened, synchronize]',
      'permissions:',
      '  contents: read',
      '  pull-requests: write',
      'jobs:',
      '  review:',
      "    runs-on: ['self-hosted']",
      "    if: '${{ github.event.pull_request.head.repo.fork == false }}'",
      '    steps: []',
      '',
    ].join('\n');

    it('uses workflow_override verbatim when it satisfies the security invariants', async () => {
      const container = makeContainer({});
      const service = new CiService(container);

      const result = await service.exportCi('ws-1', 'agent-1', {
        ...defaultInput,
        workflow_override: compliantYaml,
      });

      const wf = result.files.find((f) => f.path === WORKFLOW_PATH);
      expect(wf?.contents).toBe(compliantYaml);
    });

    it('rejects (422) a workflow_override that drops required security invariants (regression)', async () => {
      const container = makeContainer({});
      const service = new CiService(container);
      const unsafeYaml = '# my custom workflow\nname: Custom\n';

      await expect(
        service.exportCi('ws-1', 'agent-1', {
          ...defaultInput,
          workflow_override: unsafeYaml,
        }),
      ).rejects.toThrow(/security invariants/);
    });

    it('rejects a workflow_override using pull_request_target (regression)', async () => {
      const container = makeContainer({});
      const service = new CiService(container);
      const unsafeYaml = compliantYaml.replace('pull_request:', 'pull_request_target:');

      await expect(
        service.exportCi('ws-1', 'agent-1', {
          ...defaultInput,
          workflow_override: unsafeYaml,
        }),
      ).rejects.toThrow(/pull_request_target/);
    });

    it('rejects a workflow_override targeting a non-self-hosted runner (regression)', async () => {
      const container = makeContainer({});
      const service = new CiService(container);
      const unsafeYaml = compliantYaml.replace("runs-on: ['self-hosted']", 'runs-on: ubuntu-latest');

      await expect(
        service.exportCi('ws-1', 'agent-1', {
          ...defaultInput,
          workflow_override: unsafeYaml,
        }),
      ).rejects.toThrow(/self-hosted/);
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

  describe('already-installed dedup (AC-UN7)', () => {
    it('calls repo.upsertInstallation (never a second insertInstallation) for the (agent, repo) pair', async () => {
      const github = new MockGitHubClient();
      const container = makeContainer({ github });
      const service = new CiService(container);
      const repo = (service as unknown as { repo: Record<string, ReturnType<typeof vi.fn>> })
        .repo;

      await service.exportCi('ws-1', 'agent-1', defaultInput);

      expect(repo['upsertInstallation']).toHaveBeenCalledTimes(1);
      expect(repo['upsertInstallation']).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', repo: 'acme/myrepo' }),
      );
      expect(repo['insertInstallation']).not.toHaveBeenCalled();
    });
  });

  describe('ingest wiring provisioning (Step 8, AC-UN2)', () => {
    it('aborts with 422 before any GitHub call when CI_INGEST_TOKEN is not configured', async () => {
      const github = new MockGitHubClient();
      const container = makeContainer({ github, ingestToken: undefined });
      const service = new CiService(container);

      await expect(service.exportCi('ws-1', 'agent-1', defaultInput)).rejects.toThrow(
        'CI_INGEST_TOKEN',
      );
      expect(github.committed).toHaveLength(0);
      expect(github.openedPrs).toHaveLength(0);
    });

    it('returns ingest_wiring: ok when secret + variable provisioning succeeds', async () => {
      const github = new MockGitHubClient();
      const ciProvisioner = makeCiProvisioner();
      const container = makeContainer({ github, ciProvisioner });
      const service = new CiService(container);

      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      expect(result.ingest_wiring).toEqual({ status: 'ok' });
      expect(ciProvisioner.createOrUpdateActionsSecret).toHaveBeenCalledWith(
        'acme',
        'myrepo',
        'CI_INGEST_TOKEN',
        'fake-ci-ingest-token',
      );
      expect(ciProvisioner.setActionsVariable).toHaveBeenCalledWith(
        'acme',
        'myrepo',
        'DEVDIGEST_STUDIO_URL',
        expect.any(String),
      );
    });

    it('returns ingest_wiring: incomplete (never a false ok) when provisioning fails, without failing the export', async () => {
      const github = new MockGitHubClient();
      const ciProvisioner = makeCiProvisioner();
      ciProvisioner.createOrUpdateActionsSecret.mockRejectedValueOnce(new Error('boom'));
      const container = makeContainer({ github, ciProvisioner });
      const service = new CiService(container);

      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      // PR was still opened successfully — provisioning failure must not discard it.
      expect(result.pr_url).toBe('https://github.com/mock/mock/pull/1');
      expect(result.ingest_wiring).toEqual({ status: 'incomplete', error: 'boom' });
    });

    it('returns ingest_wiring: skipped for action=files (no repo to provision against)', async () => {
      const github = new MockGitHubClient();
      const container = makeContainer({ github });
      const service = new CiService(container);

      const result = await service.exportCi('ws-1', 'agent-1', {
        ...defaultInput,
        action: 'files',
      });

      expect(result.ingest_wiring).toEqual({ status: 'skipped' });
    });
  });

  // ---------------------------------------------------------------------
  // v2 regression: runner_label / studio_url used to be silently stripped
  // by ExportBody before it gained these fields. Confirm they now flow all
  // the way through to the generated workflow's `runs-on:` and to
  // CiProvisioner.setActionsVariable — and that the defaults still apply
  // when the fields are omitted (AC-U9, AC-E4b, AC-E6).
  // ---------------------------------------------------------------------
  describe('runner_label / studio_url wiring (v2 regression)', () => {
    it('threads a custom runner_label into the workflow runs-on and a custom studio_url into setActionsVariable', async () => {
      const github = new MockGitHubClient();
      const ciProvisioner = makeCiProvisioner();
      const container = makeContainer({ github, ciProvisioner });
      const service = new CiService(container);

      const result = await service.exportCi('ws-1', 'agent-1', {
        ...defaultInput,
        runner_label: ['self-hosted', 'custom-label'],
        studio_url: 'http://192.168.1.50:3001',
      });

      const wf = result.files.find((f) => f.path === WORKFLOW_PATH);
      expect(wf).toBeDefined();
      const parsed = parseYaml(wf!.contents) as {
        jobs: Record<string, { 'runs-on': string[] }>;
      };
      // The custom label must appear — not the default.
      expect(Object.values(parsed.jobs)[0]!['runs-on']).toEqual(['self-hosted', 'custom-label']);
      expect(Object.values(parsed.jobs)[0]!['runs-on']).not.toEqual(DEFAULT_RUNNER_LABEL);

      // The provisioner must receive the custom studio_url — not the hardcoded default.
      expect(ciProvisioner.setActionsVariable).toHaveBeenCalledWith(
        'acme',
        'myrepo',
        'DEVDIGEST_STUDIO_URL',
        'http://192.168.1.50:3001',
      );
      expect(ciProvisioner.setActionsVariable).not.toHaveBeenCalledWith(
        'acme',
        'myrepo',
        'DEVDIGEST_STUDIO_URL',
        DEFAULT_STUDIO_URL,
      );
    });

    it('falls back to DEFAULT_RUNNER_LABEL and DEFAULT_STUDIO_URL when both fields are omitted (no regression to default behavior)', async () => {
      const github = new MockGitHubClient();
      const ciProvisioner = makeCiProvisioner();
      const container = makeContainer({ github, ciProvisioner });
      const service = new CiService(container);

      const result = await service.exportCi('ws-1', 'agent-1', defaultInput);

      const wf = result.files.find((f) => f.path === WORKFLOW_PATH);
      const parsed = parseYaml(wf!.contents) as {
        jobs: Record<string, { 'runs-on': string[] }>;
      };
      expect(Object.values(parsed.jobs)[0]!['runs-on']).toEqual(DEFAULT_RUNNER_LABEL);

      expect(ciProvisioner.setActionsVariable).toHaveBeenCalledWith(
        'acme',
        'myrepo',
        'DEVDIGEST_STUDIO_URL',
        DEFAULT_STUDIO_URL,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// listInstallations — extended shape (Step 5, AC-E3, AC-U5)
// ---------------------------------------------------------------------------

describe('CiService.listInstallations', () => {
  it('maps the latest-run join into the CiInstallationView shape', async () => {
    const container = makeContainer({});
    const service = new CiService(container);
    const repo = (service as unknown as { repo: Record<string, unknown> }).repo;
    repo['listInstallationsWithLatestRun'] = vi.fn().mockResolvedValue([
      {
        installation: {
          id: 'install-1',
          agentId: 'agent-1',
          repo: 'acme/myrepo',
          targetType: 'gha',
          installedAt: new Date('2026-01-01T00:00:00.000Z'),
          agentVersion: 3,
        },
        lastStatus: 'success',
        lastRunAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    const result = await service.listInstallations('ws-1', 'agent-1');

    expect(result).toEqual([
      {
        id: 'install-1',
        agent_id: 'agent-1',
        repo: 'acme/myrepo',
        target_type: 'gha',
        installed_at: '2026-01-01T00:00:00.000Z',
        agent_version: 3,
        last_status: 'success',
        last_run_at: '2026-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('passes workspaceId through to the repository (regression — cross-workspace IDOR fix)', async () => {
    const container = makeContainer({});
    const service = new CiService(container);
    const repo = (service as unknown as { repo: Record<string, unknown> }).repo;
    const spy = vi.fn().mockResolvedValue([]);
    repo['listInstallationsWithLatestRun'] = spy;

    await service.listInstallations('ws-1', 'agent-1');

    expect(spy).toHaveBeenCalledWith('ws-1', 'agent-1');
  });
});

// ---------------------------------------------------------------------------
// removeInstallation (Step 5, AC-E5)
// ---------------------------------------------------------------------------

describe('CiService.removeInstallation', () => {
  it('resolves when the installation is deleted', async () => {
    const container = makeContainer({});
    const service = new CiService(container);
    const repo = (service as unknown as { repo: Record<string, unknown> }).repo;
    repo['deleteInstallation'] = vi.fn().mockResolvedValue(true);

    await expect(service.removeInstallation('install-1', 'ws-1')).resolves.toBeUndefined();
  });

  it('throws NotFoundError when the installation is not owned by the workspace (ownership guard)', async () => {
    const container = makeContainer({});
    const service = new CiService(container);
    const repo = (service as unknown as { repo: Record<string, unknown> }).repo;
    repo['deleteInstallation'] = vi.fn().mockResolvedValue(false);

    await expect(service.removeInstallation('install-1', 'ws-1')).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// getPerformance (Step 5, AC-U2, AC-U3, AC-ST1)
// ---------------------------------------------------------------------------

describe('CiService.getPerformance', () => {
  it('returns emptyPerformance when there are no runs in the window (AC-ST1)', async () => {
    const container = makeContainer({});
    const service = new CiService(container);
    const repo = (service as unknown as { repo: Record<string, unknown> }).repo;
    repo['totalsForWindow'] = vi.fn().mockResolvedValue({ totalRuns: 0, totalCostUsd: 0 });

    const result = await service.getPerformance('ws-1', '30');

    expect(result).toEqual({
      window: '30',
      total_runs: 0,
      total_cost_usd: 0,
      cost_delta_usd: null,
      avg_accept_rate: null,
      most_active_agent: null,
      agents: [],
      cost_by_agent: [],
      cost_by_model: [],
    });
  });

  it('composes totals, cost delta, per-agent accept rate + trend, most-active agent, and cost donuts', async () => {
    const container = makeContainer({});
    const service = new CiService(container);
    const repo = (service as unknown as { repo: Record<string, ReturnType<typeof vi.fn>> })
      .repo;

    repo['totalsForWindow'] = vi
      .fn()
      .mockResolvedValueOnce({ totalRuns: 10, totalCostUsd: 15 }) // current window
      .mockResolvedValueOnce({ totalRuns: 4, totalCostUsd: 10 }); // previous window
    repo['aggregateAgentRuns'] = vi.fn().mockResolvedValue([
      {
        agentId: 'agent-1',
        agentName: 'My Agent',
        runs: 10,
        totalCostUsd: 15,
        avgCostUsd: 1.5,
        avgDurationMs: 2000,
        lastRanAt: '2026-01-05T00:00:00.000Z',
      },
    ]);
    repo['acceptCountsByAgent'] = vi
      .fn()
      .mockResolvedValueOnce([{ agentId: 'agent-1', accepted: 3, dismissed: 1 }]) // current
      .mockResolvedValueOnce([{ agentId: 'agent-1', accepted: 1, dismissed: 3 }]); // previous
    repo['costByModel'] = vi.fn().mockResolvedValue([{ model: 'gpt-4o', costUsd: 15 }]);

    const result = await service.getPerformance('ws-1', '30');

    expect(result.total_runs).toBe(10);
    expect(result.total_cost_usd).toBe(15);
    expect(result.cost_delta_usd).toBe(5); // 15 - 10
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.accept_rate).toBe(0.75); // 3 / (3+1)
    expect(result.agents[0]?.trend).toBe('up'); // 0.75 > 0.25 (prev window)
    expect(result.most_active_agent).toEqual({
      agent_id: 'agent-1',
      agent_name: 'My Agent',
      runs: 10,
    });
    expect(result.cost_by_agent).toEqual([{ key: 'My Agent', cost_usd: 15 }]);
    expect(result.cost_by_model).toEqual([{ key: 'gpt-4o', cost_usd: 15 }]);
  });

  it('never divides by zero — accept_rate is null when an agent has no findings (AC-UN8)', async () => {
    const container = makeContainer({});
    const service = new CiService(container);
    const repo = (service as unknown as { repo: Record<string, ReturnType<typeof vi.fn>> })
      .repo;

    repo['totalsForWindow'] = vi
      .fn()
      .mockResolvedValueOnce({ totalRuns: 5, totalCostUsd: 5 })
      .mockResolvedValueOnce({ totalRuns: 0, totalCostUsd: 0 });
    repo['aggregateAgentRuns'] = vi.fn().mockResolvedValue([
      {
        agentId: 'agent-1',
        agentName: 'My Agent',
        runs: 5,
        totalCostUsd: 5,
        avgCostUsd: 1,
        avgDurationMs: 1000,
        lastRanAt: '2026-01-05T00:00:00.000Z',
      },
    ]);
    repo['acceptCountsByAgent'] = vi.fn().mockResolvedValue([]);
    repo['costByModel'] = vi.fn().mockResolvedValue([]);

    const result = await service.getPerformance('ws-1', '30');

    expect(result.agents[0]?.accept_rate).toBeNull();
    expect(result.agents[0]?.trend).toBeNull();
    expect(result.avg_accept_rate).toBeNull();
  });
});
