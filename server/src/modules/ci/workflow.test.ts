/**
 * Unit tests for the GitHub Actions workflow generator (Step 6).
 *
 * All tests are pure in-memory — no DB, no network, no Docker.
 */

import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { generateWorkflow } from './workflow.js';
import {
  CHECKOUT_SHA,
  SETUP_NODE_SHA,
  UPLOAD_ARTIFACT_SHA,
} from './constants.js';

function parseWorkflow(yaml: string): Record<string, unknown> {
  return parseYaml(yaml) as Record<string, unknown>;
}

describe('generateWorkflow', () => {
  const defaultInput = {
    triggers: ['opened', 'synchronize'],
    postAs: 'github_review' as const,
    base: 'main',
  };

  it('returns a non-empty string', () => {
    const result = generateWorkflow(defaultInput);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  describe('permissions (AC-U4)', () => {
    it('sets permissions.contents to read', () => {
      const wf = parseWorkflow(generateWorkflow(defaultInput));
      const perms = wf['permissions'] as Record<string, string>;
      expect(perms['contents']).toBe('read');
    });

    it('sets permissions.pull-requests to write', () => {
      const wf = parseWorkflow(generateWorkflow(defaultInput));
      const perms = wf['permissions'] as Record<string, string>;
      expect(perms['pull-requests']).toBe('write');
    });

    it('only has the two expected permission keys', () => {
      const wf = parseWorkflow(generateWorkflow(defaultInput));
      const perms = wf['permissions'] as Record<string, string>;
      expect(Object.keys(perms).sort()).toEqual(['contents', 'pull-requests'].sort());
    });
  });

  describe('OPENROUTER_API_KEY safety (AC-U5)', () => {
    it('references OPENROUTER_API_KEY only via ${{ secrets.OPENROUTER_API_KEY }}', () => {
      const yaml = generateWorkflow(defaultInput);
      // Must be present as the secret reference
      expect(yaml).toContain('${{ secrets.OPENROUTER_API_KEY }}');
    });

    it('OPENROUTER_API_KEY value is always the secrets expression, never a raw value', () => {
      const yaml = generateWorkflow(defaultInput);
      // Every line that sets OPENROUTER_API_KEY must use the secrets expression.
      // Split by lines to find all assignments and verify each one is the secrets ref.
      const lines = yaml.split('\n');
      const assignmentLines = lines.filter(
        (l) => l.includes('OPENROUTER_API_KEY:') && !l.trim().startsWith('#'),
      );
      expect(assignmentLines.length).toBeGreaterThan(0);
      for (const line of assignmentLines) {
        expect(line).toContain('${{ secrets.OPENROUTER_API_KEY }}');
      }
    });
  });

  describe('fork guard (AC-UN5)', () => {
    it('contains the fork if-guard on the job', () => {
      const yaml = generateWorkflow(defaultInput);
      expect(yaml).toContain('github.event.pull_request.head.repo.fork == false');
    });

    it('does NOT use pull_request_target as the trigger event', () => {
      const yaml = generateWorkflow(defaultInput);
      expect(yaml).not.toContain('pull_request_target');
    });
  });

  describe('pinned action SHAs (AC-U6)', () => {
    it('pins actions/checkout to a 40-char SHA', () => {
      const yaml = generateWorkflow(defaultInput);
      expect(CHECKOUT_SHA).toMatch(/^[0-9a-f]{40}$/);
      expect(yaml).toContain(`actions/checkout@${CHECKOUT_SHA}`);
    });

    it('pins actions/setup-node to a 40-char SHA', () => {
      const yaml = generateWorkflow(defaultInput);
      expect(SETUP_NODE_SHA).toMatch(/^[0-9a-f]{40}$/);
      expect(yaml).toContain(`actions/setup-node@${SETUP_NODE_SHA}`);
    });

    it('pins actions/upload-artifact to a 40-char SHA', () => {
      const yaml = generateWorkflow(defaultInput);
      expect(UPLOAD_ARTIFACT_SHA).toMatch(/^[0-9a-f]{40}$/);
      expect(yaml).toContain(`actions/upload-artifact@${UPLOAD_ARTIFACT_SHA}`);
    });

    it('every `uses:` value in the parsed YAML is pinned to a 40-char SHA', () => {
      const yaml = generateWorkflow(defaultInput);
      const wf = parseWorkflow(yaml);
      const jobs = wf['jobs'] as Record<string, { steps: { uses?: string }[] }>;
      for (const job of Object.values(jobs)) {
        for (const step of job.steps) {
          if (step.uses) {
            // Each `uses:` must end in @<40-char-sha>
            expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
          }
        }
      }
    });
  });

  describe('reopened trigger (AC-O2)', () => {
    it('omits `reopened` when not in input.triggers', () => {
      const yaml = generateWorkflow({
        triggers: ['opened', 'synchronize'],
        postAs: 'github_review',
        base: 'main',
      });
      const wf = parseWorkflow(yaml);
      const on = wf['on'] as { pull_request: { types: string[] } };
      expect(on.pull_request.types).not.toContain('reopened');
    });

    it('includes `reopened` when present in input.triggers', () => {
      const yaml = generateWorkflow({
        triggers: ['opened', 'synchronize', 'reopened'],
        postAs: 'github_review',
        base: 'main',
      });
      const wf = parseWorkflow(yaml);
      const on = wf['on'] as { pull_request: { types: string[] } };
      expect(on.pull_request.types).toContain('reopened');
    });

    it('always emits `opened` and `synchronize` regardless of input', () => {
      const yaml = generateWorkflow({
        triggers: ['reopened'],
        postAs: 'github_review',
        base: 'main',
      });
      const wf = parseWorkflow(yaml);
      const on = wf['on'] as { pull_request: { types: string[] } };
      expect(on.pull_request.types).toContain('opened');
      expect(on.pull_request.types).toContain('synchronize');
    });

    it('does not emit unknown triggers from input', () => {
      const yaml = generateWorkflow({
        // 'closed' is not in the allow-list
        triggers: ['opened', 'synchronize', 'closed'],
        postAs: 'github_review',
        base: 'main',
      });
      const wf = parseWorkflow(yaml);
      const on = wf['on'] as { pull_request: { types: string[] } };
      expect(on.pull_request.types).not.toContain('closed');
    });
  });

  describe('DEVDIGEST_POST_AS (AC-O3)', () => {
    it('sets DEVDIGEST_POST_AS to github_review', () => {
      const yaml = generateWorkflow({ ...defaultInput, postAs: 'github_review' });
      const wf = parseWorkflow(yaml);
      const jobs = wf['jobs'] as Record<string, { steps: { env?: Record<string, string> }[] }>;
      const reviewStep = Object.values(jobs)[0]!.steps.find((s) => s.env?.['DEVDIGEST_POST_AS']);
      expect(reviewStep?.env?.['DEVDIGEST_POST_AS']).toBe('github_review');
    });

    it('sets DEVDIGEST_POST_AS to pr_comment', () => {
      const yaml = generateWorkflow({ ...defaultInput, postAs: 'pr_comment' });
      const wf = parseWorkflow(yaml);
      const jobs = wf['jobs'] as Record<string, { steps: { env?: Record<string, string> }[] }>;
      const reviewStep = Object.values(jobs)[0]!.steps.find((s) => s.env?.['DEVDIGEST_POST_AS']);
      expect(reviewStep?.env?.['DEVDIGEST_POST_AS']).toBe('pr_comment');
    });

    it('sets DEVDIGEST_POST_AS to none', () => {
      const yaml = generateWorkflow({ ...defaultInput, postAs: 'none' });
      const wf = parseWorkflow(yaml);
      const jobs = wf['jobs'] as Record<string, { steps: { env?: Record<string, string> }[] }>;
      const reviewStep = Object.values(jobs)[0]!.steps.find((s) => s.env?.['DEVDIGEST_POST_AS']);
      expect(reviewStep?.env?.['DEVDIGEST_POST_AS']).toBe('none');
    });
  });

  describe('env var contract (matches agent-runner/src/context.ts)', () => {
    it('includes GITHUB_REPOSITORY and PR_NUMBER env vars', () => {
      const yaml = generateWorkflow(defaultInput);
      expect(yaml).toContain('GITHUB_REPOSITORY');
      expect(yaml).toContain('PR_NUMBER');
    });

    it('includes GITHUB_TOKEN from secrets', () => {
      const yaml = generateWorkflow(defaultInput);
      expect(yaml).toContain('${{ secrets.GITHUB_TOKEN }}');
    });
  });
});
