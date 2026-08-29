/**
 * Unit tests for the Octokit-backed CiProvisioner (Step 7).
 *
 * All tests use a stub Octokit `actions` client — no real network calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OctokitCiProvisioner } from '../../adapters/github/ci-provisioner.js';

// A valid 32-byte X25519 public key, base64-encoded, so libsodium's
// crypto_box_seal accepts it as a real key during the sealed-box path.
const FAKE_PUBLIC_KEY_B64 = Buffer.alloc(32, 7).toString('base64');

function makeStubActions() {
  return {
    getRepoPublicKey: vi.fn().mockResolvedValue({
      data: { key: FAKE_PUBLIC_KEY_B64, key_id: 'key-id-123' },
    }),
    createOrUpdateRepoSecret: vi.fn().mockResolvedValue({}),
    createRepoVariable: vi.fn().mockResolvedValue({}),
    updateRepoVariable: vi.fn().mockResolvedValue({}),
  };
}

describe('OctokitCiProvisioner', () => {
  let actions: ReturnType<typeof makeStubActions>;
  let provisioner: OctokitCiProvisioner;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    actions = makeStubActions();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provisioner = new OctokitCiProvisioner(actions as any);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  describe('createOrUpdateActionsSecret (sealed-box, AC-O1, AC-U7)', () => {
    it('fetches the repo public key before sealing the value', async () => {
      await provisioner.createOrUpdateActionsSecret('acme', 'myrepo', 'CI_INGEST_TOKEN', 'super-secret-value');
      expect(actions.getRepoPublicKey).toHaveBeenCalledWith({ owner: 'acme', repo: 'myrepo' });
    });

    it('calls createOrUpdateRepoSecret with an encrypted_value that is NOT the plaintext', async () => {
      const plaintext = 'super-secret-value';
      await provisioner.createOrUpdateActionsSecret('acme', 'myrepo', 'CI_INGEST_TOKEN', plaintext);
      expect(actions.createOrUpdateRepoSecret).toHaveBeenCalledTimes(1);
      const call = actions.createOrUpdateRepoSecret.mock.calls[0]![0];
      expect(call.owner).toBe('acme');
      expect(call.repo).toBe('myrepo');
      expect(call.secret_name).toBe('CI_INGEST_TOKEN');
      expect(call.key_id).toBe('key-id-123');
      expect(typeof call.encrypted_value).toBe('string');
      expect(call.encrypted_value).not.toBe(plaintext);
      expect(call.encrypted_value.length).toBeGreaterThan(0);
    });

    it('never logs the plaintext or encrypted secret value', async () => {
      const plaintext = 'super-secret-value-xyz';
      await provisioner.createOrUpdateActionsSecret('acme', 'myrepo', 'CI_INGEST_TOKEN', plaintext);
      for (const call of logSpy.mock.calls) {
        const serialized = call.map((a) => String(a)).join(' ');
        expect(serialized).not.toContain(plaintext);
      }
      const encryptedValue = actions.createOrUpdateRepoSecret.mock.calls[0]![0].encrypted_value;
      for (const call of logSpy.mock.calls) {
        const serialized = call.map((a) => String(a)).join(' ');
        expect(serialized).not.toContain(encryptedValue);
      }
    });

    it('propagates errors from the underlying Octokit call', async () => {
      actions.createOrUpdateRepoSecret.mockRejectedValueOnce(new Error('boom'));
      await expect(
        provisioner.createOrUpdateActionsSecret('acme', 'myrepo', 'CI_INGEST_TOKEN', 'value'),
      ).rejects.toThrow('boom');
    });
  });

  describe('setActionsVariable (create-then-update fallback, AC-O1)', () => {
    it('calls createRepoVariable when the variable does not exist yet', async () => {
      await provisioner.setActionsVariable('acme', 'myrepo', 'DEVDIGEST_STUDIO_URL', 'https://studio.example.com');
      expect(actions.createRepoVariable).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'myrepo',
        name: 'DEVDIGEST_STUDIO_URL',
        value: 'https://studio.example.com',
      });
      expect(actions.updateRepoVariable).not.toHaveBeenCalled();
    });

    it('falls back to updateRepoVariable on a 409 (already exists)', async () => {
      const conflict = Object.assign(new Error('already exists'), { status: 409 });
      actions.createRepoVariable.mockRejectedValueOnce(conflict);

      await provisioner.setActionsVariable('acme', 'myrepo', 'DEVDIGEST_STUDIO_URL', 'https://studio.example.com');

      expect(actions.createRepoVariable).toHaveBeenCalledTimes(1);
      expect(actions.updateRepoVariable).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'myrepo',
        name: 'DEVDIGEST_STUDIO_URL',
        value: 'https://studio.example.com',
      });
    });

    it('propagates non-409 errors without falling back to update', async () => {
      const serverError = Object.assign(new Error('server error'), { status: 500 });
      actions.createRepoVariable.mockRejectedValueOnce(serverError);

      await expect(
        provisioner.setActionsVariable('acme', 'myrepo', 'DEVDIGEST_STUDIO_URL', 'https://studio.example.com'),
      ).rejects.toThrow('server error');
      expect(actions.updateRepoVariable).not.toHaveBeenCalled();
    });
  });
});
