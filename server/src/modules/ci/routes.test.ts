/**
 * Unit tests for route-local request schemas in server/src/modules/ci/routes.ts.
 *
 * Pure in-memory Zod parse tests — no DB, no network, no Docker.
 *
 * Regression coverage (v2): `runner_label` and `studio_url` were added to
 * `ExportBody` so the wizard's self-hosted runner label / studio URL fields
 * (AC-E4b) are no longer silently stripped before reaching CiService — Zod
 * strips any key not declared on the schema, so an export request carrying
 * these fields previously had them dropped with no error and no effect on
 * the generated workflow or provisioning call (see service.test.ts for the
 * end-to-end wiring regression).
 *
 * Security regression (v2): `studio_url` is restricted to private-network
 * hosts (localhost / RFC1918) because the spec mandates the studio is
 * reachable only via a self-hosted runner on the operator's private network
 * — accepting an arbitrary public URL would let a client redirect the
 * shared CI_INGEST_TOKEN to an attacker-controlled host (see
 * `isPrivateNetworkStudioUrl` in helpers.ts).
 */
import { describe, it, expect } from 'vitest';
import { ExportBody } from './routes.js';

const baseInput = {
  repo: 'acme/myrepo',
  target: 'gha' as const,
  action: 'open_pr' as const,
  post_as: 'github_review' as const,
  triggers: ['opened', 'synchronize'],
  base: 'main',
};

describe('ExportBody (v2 regression — runner_label / studio_url)', () => {
  it('accepts and preserves runner_label and studio_url when provided (not stripped)', () => {
    const result = ExportBody.safeParse({
      ...baseInput,
      runner_label: ['self-hosted', 'custom-label'],
      studio_url: 'http://192.168.1.50:3001',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runner_label).toEqual(['self-hosted', 'custom-label']);
      expect(result.data.studio_url).toBe('http://192.168.1.50:3001');
    }
  });

  it('rejects a public-host studio_url (private-network-only, security regression)', () => {
    const result = ExportBody.safeParse({
      ...baseInput,
      studio_url: 'https://attacker.example.com',
    });
    expect(result.success).toBe(false);
  });

  it('accepts localhost and RFC1918 studio_url variants', () => {
    for (const url of [
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://10.0.0.5:3001',
      'http://172.16.0.5:3001',
      'http://192.168.0.5:3001',
    ]) {
      const result = ExportBody.safeParse({ ...baseInput, studio_url: url });
      expect(result.success, `expected ${url} to be accepted`).toBe(true);
    }
  });

  it('parses successfully with both fields omitted (undefined, not defaulted here)', () => {
    const result = ExportBody.safeParse(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runner_label).toBeUndefined();
      expect(result.data.studio_url).toBeUndefined();
    }
  });

  it('rejects an empty runner_label array', () => {
    const result = ExportBody.safeParse({ ...baseInput, runner_label: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a runner_label that omits "self-hosted" (security regression — GitHub-hosted runner bypass)', () => {
    const result = ExportBody.safeParse({ ...baseInput, runner_label: ['ubuntu-latest'] });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string studio_url', () => {
    const result = ExportBody.safeParse({ ...baseInput, studio_url: '' });
    expect(result.success).toBe(false);
  });

  it('still rejects a malformed repo (owner/name refinement unaffected by the new fields)', () => {
    const result = ExportBody.safeParse({
      ...baseInput,
      repo: 'not-a-valid-repo',
      runner_label: ['self-hosted'],
      studio_url: 'http://localhost:3001',
    });
    expect(result.success).toBe(false);
  });
});
