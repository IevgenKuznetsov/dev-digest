/**
 * `CiProvisioner` — module-local interface for wiring a target repo's GitHub
 * Actions secrets/variables during CI export (Step 7).
 *
 * This is intentionally NOT part of `vendor/shared` (`GitHubClient`).
 * Extending the shared `GitHubClient` interface would require editing the
 * extend-only `vendor/shared/adapters.ts` contract and the shared
 * `MockGitHubClient` test double in `adapters/mocks.ts` — both are
 * off-limits (see root/`server` CLAUDE.md "Do not touch"). Keeping this
 * interface local to the `ci` module avoids touching either file and keeps
 * the Octokit-backed implementation trivially replaceable with a test
 * double.
 */
export interface CiProvisioner {
  /**
   * Create or overwrite a GitHub Actions repo secret (idempotent — AC-O1).
   *
   * Implementations MUST sealed-box encrypt `value` against the repo's
   * Actions public key before sending it to GitHub, and MUST NOT log the
   * plaintext (or encrypted) value anywhere (AC-U7).
   */
  createOrUpdateActionsSecret(
    owner: string,
    repo: string,
    name: string,
    value: string,
  ): Promise<void>;

  /**
   * Create a GitHub Actions repo variable, or update it if one with the
   * same name already exists (idempotent create-or-update — AC-O1).
   */
  setActionsVariable(
    owner: string,
    repo: string,
    name: string,
    value: string,
  ): Promise<void>;
}
