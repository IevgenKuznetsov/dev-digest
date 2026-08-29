import { Octokit } from 'octokit';
import sodium from 'libsodium-wrappers';
import type { CiProvisioner } from '../../modules/ci/provisioner.js';

/**
 * The subset of `Octokit.rest.actions` this adapter depends on. Narrowed to
 * a `Pick` so unit tests can inject a stub object instead of a real Octokit
 * client (Step 7 test plan: "stub Octokit").
 */
type ActionsClient = Pick<
  Octokit['rest']['actions'],
  'getRepoPublicKey' | 'createOrUpdateRepoSecret' | 'createRepoVariable' | 'updateRepoVariable'
>;

/**
 * Octokit-backed `CiProvisioner` (Step 7).
 *
 * - `createOrUpdateActionsSecret`: fetch the repo's Actions public key,
 *   sealed-box encrypt the plaintext value with libsodium
 *   (`crypto_box_seal`), then PUT the encrypted value via
 *   `actions.createOrUpdateRepoSecret` — idempotent overwrite/create
 *   (AC-O1). The plaintext value is never logged (AC-U7).
 * - `setActionsVariable`: try `actions.createRepoVariable`; on 409
 *   (variable already exists) fall back to `actions.updateRepoVariable` —
 *   idempotent create-or-update (AC-O1).
 *
 * Errors from either Octokit call propagate to the caller (surfaced by
 * Step 8's `exportCi` provisioning result).
 */
export class OctokitCiProvisioner implements CiProvisioner {
  constructor(private actions: ActionsClient) {}

  async createOrUpdateActionsSecret(
    owner: string,
    repo: string,
    name: string,
    value: string,
  ): Promise<void> {
    const { data: publicKey } = await this.actions.getRepoPublicKey({ owner, repo });

    await sodium.ready;
    const sealed = sodium.crypto_box_seal(
      sodium.from_string(value),
      sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL),
    );
    const encryptedValue = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);

    await this.actions.createOrUpdateRepoSecret({
      owner,
      repo,
      secret_name: name,
      encrypted_value: encryptedValue,
      key_id: publicKey.key_id,
    });
    // `value` / `encryptedValue` are intentionally never logged here (AC-U7).
  }

  async setActionsVariable(
    owner: string,
    repo: string,
    name: string,
    value: string,
  ): Promise<void> {
    try {
      await this.actions.createRepoVariable({ owner, repo, name, value });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 409) throw err;
      // Already exists — idempotent update fallback (AC-O1).
      await this.actions.updateRepoVariable({ owner, repo, name, value });
    }
  }
}

/** Build an `OctokitCiProvisioner` from a GITHUB_TOKEN, for container wiring (Step 8). */
export function createOctokitCiProvisioner(token: string): OctokitCiProvisioner {
  return new OctokitCiProvisioner(new Octokit({ auth: token }).rest.actions);
}
