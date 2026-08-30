/**
 * Unit tests for server/src/modules/ci/helpers.ts
 *
 * Pure in-memory — no DB, no network, no Docker.
 * Covers: slugify, assertNoDuplicateSlugs, manifestFromAgent, parseRepoRef,
 *         bundleFiles (editable flags), serializeManifest (round-trip).
 */

import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import {
  slugify,
  assertNoDuplicateSlugs,
  manifestFromAgent,
  parseRepoRef,
  bundleFiles,
  serializeManifest,
  acceptRate,
  costDelta,
  trendArrow,
  toCostSlices,
  emptyPerformance,
  isPrivateNetworkStudioUrl,
  isSelfHostedRunnerLabel,
  validateWorkflowOverride,
} from './helpers.js';
import { MANIFEST_DIR, SKILLS_DIR, RUNNER_PATH } from './constants.js';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'My Review Agent',
    description: '',
    provider: 'openrouter',
    model: 'openai/gpt-4o',
    systemPrompt: 'Review carefully.',
    outputSchema: null,
    strategy: 'auto',
    ciFailOn: 'critical',
    repoIntel: true,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  } as Parameters<typeof manifestFromAgent>[0];
}

const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lower-cases input', () => {
    expect(slugify('HELLO')).toBe('hello');
  });

  it('replaces spaces with hyphens', () => {
    expect(slugify('Security Review')).toBe('security-review');
  });

  it('replaces non-alphanumeric characters with hyphens', () => {
    expect(slugify('My Skill (v2)')).toBe('my-skill-v2');
  });

  it('collapses consecutive hyphens', () => {
    expect(slugify('foo  --  bar')).toBe('foo-bar');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('---foo---')).toBe('foo');
  });

  it('returns empty string for all-special input', () => {
    expect(slugify('!!!')).toBe('');
  });

  it('preserves existing hyphens', () => {
    expect(slugify('code-quality')).toBe('code-quality');
  });
});

// ---------------------------------------------------------------------------
// assertNoDuplicateSlugs
// ---------------------------------------------------------------------------

describe('assertNoDuplicateSlugs', () => {
  it('does not throw when all slugs are unique', () => {
    expect(() => assertNoDuplicateSlugs(['foo', 'bar', 'baz'])).not.toThrow();
  });

  it('does not throw on an empty list', () => {
    expect(() => assertNoDuplicateSlugs([])).not.toThrow();
  });

  it('throws a descriptive error when a duplicate slug is present', () => {
    expect(() => assertNoDuplicateSlugs(['foo', 'bar', 'foo'])).toThrowError(
      /slug collision/i,
    );
  });

  it('includes the colliding slug in the error message', () => {
    expect(() => assertNoDuplicateSlugs(['alpha', 'alpha'])).toThrowError('alpha');
  });
});

// ---------------------------------------------------------------------------
// manifestFromAgent
// ---------------------------------------------------------------------------

describe('manifestFromAgent', () => {
  it('maps agent fields to AgentManifest shape', () => {
    const agent = makeAgent();
    const manifest = manifestFromAgent(agent, ['security-review']);

    expect(manifest.name).toBe('My Review Agent');
    expect(manifest.model).toBe('openai/gpt-4o');
    expect(manifest.system_prompt).toBe('Review carefully.');
    expect(manifest.skills).toEqual(['security-review']);
    expect(manifest.provider).toBe('openrouter');
    expect(manifest.strategy).toBe('auto');
    expect(manifest.ci_fail_on).toBe('critical');
  });

  it('passes AgentManifest.parse validation', () => {
    const manifest = manifestFromAgent(makeAgent(), []);
    expect(() => AgentManifest.parse(manifest)).not.toThrow();
  });

  it('includes all skill slugs in skills array', () => {
    const manifest = manifestFromAgent(makeAgent(), ['slug-a', 'slug-b']);
    expect(manifest.skills).toEqual(['slug-a', 'slug-b']);
  });

  it('never contains the string OPENROUTER_API_KEY as a value', () => {
    const agent = makeAgent({ systemPrompt: 'Never leak keys' });
    const manifest = manifestFromAgent(agent, []);
    const json = JSON.stringify(manifest);
    // The key name as a field name is fine; having it as a value would be a leak
    expect(json).not.toMatch(/"OPENROUTER_API_KEY"/);
  });
});

// ---------------------------------------------------------------------------
// parseRepoRef
// ---------------------------------------------------------------------------

describe('parseRepoRef', () => {
  it('splits owner/name correctly', () => {
    expect(parseRepoRef('acme/myrepo')).toEqual({ owner: 'acme', name: 'myrepo' });
  });

  it('handles org names with hyphens and dots', () => {
    expect(parseRepoRef('my-org/my.repo')).toEqual({ owner: 'my-org', name: 'my.repo' });
  });

  it('returns only owner and name (ignores any extra slashes)', () => {
    const result = parseRepoRef('owner/repo/extra');
    // split('/', 2) gives ['owner', 'repo']
    expect(result.owner).toBe('owner');
    expect(result.name).toBe('repo');
  });
});

// ---------------------------------------------------------------------------
// bundleFiles — editable flags (AC-U8)
// ---------------------------------------------------------------------------

describe('bundleFiles', () => {
  const baseInput = {
    agentSlug: 'my-agent',
    manifestYaml: 'name: My Agent\n',
    skills: [{ slug: 'security-review', body: '# Security\n' }],
    runnerBundle: '// runner',
    workflowYaml: 'name: CI\n',
    workflowPath: WORKFLOW_PATH,
  };

  it('workflow file has editable=true', () => {
    const files = bundleFiles(baseInput);
    const wf = files.find((f) => f.path === WORKFLOW_PATH);
    expect(wf?.editable).toBe(true);
  });

  it('manifest file has editable=false', () => {
    const files = bundleFiles(baseInput);
    const mf = files.find((f) => f.path.startsWith(MANIFEST_DIR));
    expect(mf?.editable).toBe(false);
  });

  it('skill files have editable=false', () => {
    const files = bundleFiles(baseInput);
    const sf = files.find((f) => f.path.startsWith(SKILLS_DIR));
    expect(sf?.editable).toBe(false);
  });

  it('runner file has editable=false', () => {
    const files = bundleFiles(baseInput);
    const rf = files.find((f) => f.path === RUNNER_PATH);
    expect(rf?.editable).toBe(false);
  });

  it('manifest file path follows <MANIFEST_DIR>/<slug>.yaml convention', () => {
    const files = bundleFiles(baseInput);
    const mf = files.find((f) => f.path === `${MANIFEST_DIR}/my-agent.yaml`);
    expect(mf).toBeDefined();
    expect(mf?.contents).toBe('name: My Agent\n');
  });

  it('skill file path follows <SKILLS_DIR>/<slug>.md convention', () => {
    const files = bundleFiles(baseInput);
    const sf = files.find((f) => f.path === `${SKILLS_DIR}/security-review.md`);
    expect(sf).toBeDefined();
    expect(sf?.contents).toBe('# Security\n');
  });

  it('emits no memory.jsonl file (v1 AC-O1 omit branch)', () => {
    const files = bundleFiles(baseInput);
    expect(files.some((f) => f.path.includes('memory.jsonl'))).toBe(false);
  });

  it('works with no skills', () => {
    const files = bundleFiles({ ...baseInput, skills: [] });
    const skillFiles = files.filter((f) => f.path.startsWith(SKILLS_DIR));
    expect(skillFiles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// serializeManifest — YAML round-trip
// ---------------------------------------------------------------------------

describe('serializeManifest', () => {
  const manifest: AgentManifest = {
    name: 'My Agent',
    provider: 'openrouter',
    model: 'openai/gpt-4o',
    system_prompt: 'Be helpful.',
    skills: ['code-quality'],
    strategy: 'auto',
    ci_fail_on: 'critical',
  };

  it('returns a non-empty string', () => {
    const yaml = serializeManifest(manifest);
    expect(typeof yaml).toBe('string');
    expect(yaml.length).toBeGreaterThan(0);
  });

  it('round-trips through AgentManifest.parse', () => {
    const yaml = serializeManifest(manifest);
    const parsed = parseYaml(yaml);
    const validated = AgentManifest.safeParse(parsed);
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.name).toBe('My Agent');
      expect(validated.data.model).toBe('openai/gpt-4o');
      expect(validated.data.skills).toEqual(['code-quality']);
    }
  });

  it('does not contain OPENROUTER_API_KEY (AC-U5)', () => {
    const yaml = serializeManifest(manifest);
    // The key name can appear in comments/docs but never as a value assignment
    const lines = yaml.split('\n');
    for (const line of lines) {
      if (!line.trim().startsWith('#')) {
        expect(line).not.toMatch(/OPENROUTER_API_KEY:\s*[^$]/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// acceptRate
// ---------------------------------------------------------------------------

describe('acceptRate', () => {
  it('returns null when accepted + dismissed === 0 (no divide-by-zero, AC-UN8)', () => {
    expect(acceptRate(0, 0)).toBeNull();
  });

  it('returns 1 when all accepted', () => {
    expect(acceptRate(4, 0)).toBe(1);
  });

  it('returns 0 when all dismissed', () => {
    expect(acceptRate(0, 4)).toBe(0);
  });

  it('computes the ratio for a mix of accepted/dismissed', () => {
    expect(acceptRate(3, 1)).toBe(0.75);
  });
});

// ---------------------------------------------------------------------------
// costDelta
// ---------------------------------------------------------------------------

describe('costDelta', () => {
  it('returns the signed difference for a nonzero previous window', () => {
    expect(costDelta(150, 100)).toBe(50);
    expect(costDelta(80, 100)).toBe(-20);
  });

  it('returns 0 when both current and previous are 0', () => {
    expect(costDelta(0, 0)).toBe(0);
  });

  it('returns current value (not divide-by-zero) when previous window is 0 (Edge 4)', () => {
    expect(costDelta(42, 0)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// trendArrow
// ---------------------------------------------------------------------------

describe('trendArrow', () => {
  it('returns "up" when current > previous', () => {
    expect(trendArrow(10, 5)).toBe('up');
  });

  it('returns "down" when current < previous', () => {
    expect(trendArrow(5, 10)).toBe('down');
  });

  it('returns "flat" when current === previous', () => {
    expect(trendArrow(5, 5)).toBe('flat');
  });

  it('returns null when current is null', () => {
    expect(trendArrow(null, 5)).toBeNull();
  });

  it('returns null when previous is null', () => {
    expect(trendArrow(5, null)).toBeNull();
  });

  it('returns null when both are null', () => {
    expect(trendArrow(null, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toCostSlices
// ---------------------------------------------------------------------------

describe('toCostSlices', () => {
  it('maps {key, costUsd} rows to {key, cost_usd}', () => {
    const slices = toCostSlices([{ key: 'gpt-4o', costUsd: 1.5 }]);
    expect(slices).toEqual([{ key: 'gpt-4o', cost_usd: 1.5 }]);
  });

  it('sorts slices descending by cost', () => {
    const slices = toCostSlices([
      { key: 'a', costUsd: 1 },
      { key: 'b', costUsd: 5 },
      { key: 'c', costUsd: 3 },
    ]);
    expect(slices.map((s) => s.key)).toEqual(['b', 'c', 'a']);
  });

  it('returns an empty array for no rows', () => {
    expect(toCostSlices([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// emptyPerformance
// ---------------------------------------------------------------------------

describe('emptyPerformance', () => {
  it('returns a fully zeroed AgentPerformance shape (AC-ST1)', () => {
    expect(emptyPerformance('30')).toEqual({
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

  it('preserves the requested window value', () => {
    expect(emptyPerformance('7').window).toBe('7');
    expect(emptyPerformance('90').window).toBe('90');
  });
});

describe('isPrivateNetworkStudioUrl (security — studio URL allowlist)', () => {
  it('accepts localhost and loopback addresses', () => {
    expect(isPrivateNetworkStudioUrl('http://localhost:3001')).toBe(true);
    expect(isPrivateNetworkStudioUrl('https://localhost:3001')).toBe(true);
    expect(isPrivateNetworkStudioUrl('http://127.0.0.1:3001')).toBe(true);
    expect(isPrivateNetworkStudioUrl('http://[::1]:3001')).toBe(true);
  });

  it('accepts RFC1918 private ranges', () => {
    expect(isPrivateNetworkStudioUrl('http://10.0.0.5:3001')).toBe(true);
    expect(isPrivateNetworkStudioUrl('http://172.16.0.5:3001')).toBe(true);
    expect(isPrivateNetworkStudioUrl('http://172.31.255.255:3001')).toBe(true);
    expect(isPrivateNetworkStudioUrl('http://192.168.0.5:3001')).toBe(true);
  });

  it('rejects public hosts (prevents CI_INGEST_TOKEN exfiltration)', () => {
    expect(isPrivateNetworkStudioUrl('https://attacker.example.com')).toBe(false);
    expect(isPrivateNetworkStudioUrl('http://8.8.8.8')).toBe(false);
    expect(isPrivateNetworkStudioUrl('http://172.32.0.1')).toBe(false); // just outside 172.16/12
    expect(isPrivateNetworkStudioUrl('http://172.15.255.255')).toBe(false); // just below 172.16/12
  });

  it('rejects non-http(s) schemes and malformed URLs', () => {
    expect(isPrivateNetworkStudioUrl('ftp://localhost:3001')).toBe(false);
    expect(isPrivateNetworkStudioUrl('not-a-url')).toBe(false);
    expect(isPrivateNetworkStudioUrl('')).toBe(false);
  });
});

describe('isSelfHostedRunnerLabel (security — self-hosted-only runner boundary)', () => {
  it('accepts label sets that include "self-hosted"', () => {
    expect(isSelfHostedRunnerLabel(['self-hosted'])).toBe(true);
    expect(isSelfHostedRunnerLabel(['self-hosted', 'devdigest'])).toBe(true);
    expect(isSelfHostedRunnerLabel(['custom', 'self-hosted'])).toBe(true);
  });

  it('rejects label sets that omit "self-hosted" (GitHub-hosted runner bypass)', () => {
    expect(isSelfHostedRunnerLabel(['ubuntu-latest'])).toBe(false);
    expect(isSelfHostedRunnerLabel([])).toBe(false);
  });
});

describe('validateWorkflowOverride (security — author-edited workflow invariants)', () => {
  const compliantYaml = [
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

  it('returns no violations for a compliant workflow', () => {
    expect(validateWorkflowOverride(compliantYaml)).toEqual([]);
  });

  it('flags invalid YAML', () => {
    const violations = validateWorkflowOverride('not: valid: yaml: [');
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags a non-mapping document', () => {
    expect(validateWorkflowOverride('- just\n- a\n- list\n')).toEqual([
      'workflow_override must be a YAML mapping',
    ]);
  });

  it('flags the pull_request_target trigger (secret exposure to fork PRs)', () => {
    const yaml = compliantYaml.replace('pull_request:', 'pull_request_target:');
    const violations = validateWorkflowOverride(yaml);
    expect(violations.some((v) => v.includes('pull_request_target'))).toBe(true);
  });

  it('flags a missing permissions block', () => {
    const yaml = compliantYaml.replace(/permissions:\n {2}contents: read\n {2}pull-requests: write\n/, '');
    const violations = validateWorkflowOverride(yaml);
    expect(violations.some((v) => v.includes('permissions'))).toBe(true);
  });

  it('flags write-all/read-all permissions', () => {
    const yaml = compliantYaml.replace(
      'permissions:\n  contents: read\n  pull-requests: write\n',
      'permissions: write-all\n',
    );
    const violations = validateWorkflowOverride(yaml);
    expect(violations.some((v) => v.includes('write-all'))).toBe(true);
  });

  it('flags an unexpected permission scope', () => {
    const yaml = compliantYaml.replace(
      'permissions:\n  contents: read\n  pull-requests: write\n',
      'permissions:\n  contents: read\n  pull-requests: write\n  actions: write\n',
    );
    const violations = validateWorkflowOverride(yaml);
    expect(violations.some((v) => v.includes('actions'))).toBe(true);
  });

  it('flags a non-self-hosted runs-on', () => {
    const yaml = compliantYaml.replace("runs-on: ['self-hosted']", 'runs-on: ubuntu-latest');
    const violations = validateWorkflowOverride(yaml);
    expect(violations.some((v) => v.includes('self-hosted'))).toBe(true);
  });

  it('flags a missing fork-PR guard', () => {
    const yaml = compliantYaml.replace(
      "    if: '${{ github.event.pull_request.head.repo.fork == false }}'\n",
      '',
    );
    const violations = validateWorkflowOverride(yaml);
    expect(violations.some((v) => v.includes('fork'))).toBe(true);
  });

  it('flags a workflow with no jobs', () => {
    const violations = validateWorkflowOverride('name: Custom\non:\n  pull_request: {}\n');
    expect(violations.some((v) => v.includes('at least one job'))).toBe(true);
  });

  // Regression coverage for a targeted security re-review that found 4
  // bypasses in the first version of this validator (all confirmed fixed).
  describe('bypass regressions (security re-review)', () => {
    it('flags pull_request_target given as the bare string form of "on:"', () => {
      const yaml = compliantYaml.replace(
        'on:\n  pull_request:\n    types: [opened, synchronize]',
        'on: pull_request_target',
      );
      const violations = validateWorkflowOverride(yaml);
      expect(violations.some((v) => v.includes('pull_request_target'))).toBe(true);
    });

    it('flags pull_request_target given as an array form of "on:"', () => {
      const yaml = compliantYaml.replace(
        'on:\n  pull_request:\n    types: [opened, synchronize]',
        'on: [pull_request_target]',
      );
      const violations = validateWorkflowOverride(yaml);
      expect(violations.some((v) => v.includes('pull_request_target'))).toBe(true);
    });

    it('flags a fork guard defeated by a tautological "||" condition', () => {
      const yaml = compliantYaml.replace(
        "if: '${{ github.event.pull_request.head.repo.fork == false }}'",
        "if: 'true || github.event.pull_request.head.repo.fork == false'",
      );
      const violations = validateWorkflowOverride(yaml);
      expect(violations.some((v) => v.includes('fork'))).toBe(true);
    });

    it('flags an empty/null top-level "permissions:" key', () => {
      const yaml = compliantYaml.replace(
        'permissions:\n  contents: read\n  pull-requests: write\n',
        'permissions:\n',
      );
      const violations = validateWorkflowOverride(yaml);
      expect(violations.some((v) => v.includes('permissions'))).toBe(true);
    });

    it('flags a job-level "permissions:" override that escalates beyond the top-level block', () => {
      const yaml = compliantYaml.replace(
        "    runs-on: ['self-hosted']",
        "    permissions:\n      contents: write\n      actions: write\n    runs-on: ['self-hosted']",
      );
      const violations = validateWorkflowOverride(yaml);
      expect(violations.some((v) => v.includes('actions'))).toBe(true);
      expect(violations.some((v) => v.includes('permissions.contents'))).toBe(true);
    });
  });
});
