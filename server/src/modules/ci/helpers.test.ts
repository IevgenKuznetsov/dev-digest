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
