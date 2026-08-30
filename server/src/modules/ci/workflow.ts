/**
 * GitHub Actions workflow generator for the Export to CI feature.
 *
 * Security invariants enforced by this function:
 * - permissions: contents:read, pull-requests:write only (AC-U4)
 * - OPENROUTER_API_KEY only via ${{ secrets.* }} (AC-U5)
 * - External actions pinned to full commit SHAs (AC-U6)
 * - Fork PR guard via job-level `if` (AC-UN5)
 * - triggers emit only from the fixed allow-list (AC-O2)
 * - DEVDIGEST_POST_AS reflects input.postAs (AC-O3)
 */

import { stringify as yamlStringify } from 'yaml';
import {
  CHECKOUT_SHA,
  SETUP_NODE_SHA,
  UPLOAD_ARTIFACT_SHA,
  RUNNER_PATH,
  RESULT_FILE,
  DEFAULT_RUNNER_LABEL,
  DEVDIGEST_STUDIO_URL_VAR,
} from './constants.js';

export interface GenerateWorkflowInput {
  triggers: string[];
  postAs: 'github_review' | 'pr_comment' | 'none';
  base: string;
  /**
   * `runs-on:` label set for the job (AC-U9). Defaults to
   * `DEFAULT_RUNNER_LABEL` (`['self-hosted', 'devdigest']`) when omitted.
   * No tunnel/relay config is emitted for this.
   */
  runnerLabel?: string[];
  /**
   * Accepted for interface completeness / future provisioning callers
   * (Step 7/8's `CiProvisioner.setActionsVariable`). NOT interpolated into
   * the generated YAML — the ingest step always reads the studio URL from
   * the `${{ vars.DEVDIGEST_STUDIO_URL }}` repo Variable at run time, never
   * a raw literal baked in at generation time (AC-U7).
   */
  studioUrl?: string;
}

/**
 * The fixed trigger allow-list. Raw trigger strings from input are NEVER
 * interpolated — only values present in this list can appear in the workflow.
 * `reopened` is included only when the caller requests it (AC-O2).
 */
const TRIGGER_ALLOWLIST = new Set(['opened', 'synchronize', 'reopened']);

/**
 * Generate the `.github/workflows/devdigest-review.yml` YAML string.
 *
 * The workflow is built as a plain JS object and serialized with the `yaml`
 * package — never by string-concatenating untrusted input into keys.
 *
 * @param input - triggers, postAs publish mode, and target base branch.
 * @returns A valid YAML string for the GitHub Actions workflow file.
 */
export function generateWorkflow(input: GenerateWorkflowInput): string {
  // Intersect caller-supplied triggers with the fixed allow-list.
  // Always include `opened` and `synchronize`; add `reopened` only when present.
  const allowedTriggers: string[] = ['opened', 'synchronize'];
  if (input.triggers.includes('reopened') && TRIGGER_ALLOWLIST.has('reopened')) {
    allowedTriggers.push('reopened');
  }

  const workflow = {
    name: 'DevDigest Review',

    // Event trigger: pull_request only (never pull_request_target).
    // pull_request_target would grant secrets to untrusted fork code — use
    // the fork `if` guard on the job instead (AC-UN5).
    on: {
      pull_request: {
        types: allowedTriggers,
      },
    },

    // Least-privilege permissions block (AC-U4).
    // All others default to `none` — only the two needed permissions are set.
    permissions: {
      contents: 'read',
      'pull-requests': 'write',
    },

    jobs: {
      'devdigest-review': {
        name: 'DevDigest Review',
        // Self-hosted runner (AC-U9) — no GitHub-hosted fallback, no tunnel/relay.
        'runs-on': input.runnerLabel ?? DEFAULT_RUNNER_LABEL,

        // Fork PR guard (AC-UN5): skip this job entirely when the PR head
        // originates from a fork. Forked PRs have no access to repository
        // secrets — this guard prevents the job from running AND from
        // accidentally exposing secrets via a privileged trigger.
        // Do NOT use pull_request_target; use pull_request with this guard.
        if: '${{ github.event.pull_request.head.repo.fork == false }}',

        steps: [
          {
            name: 'Checkout',
            // Pinned to full commit SHA — never a mutable tag (AC-U6).
            uses: `actions/checkout@${CHECKOUT_SHA}`,
          },

          {
            name: 'Setup Node',
            // Pinned to full commit SHA (AC-U6).
            uses: `actions/setup-node@${SETUP_NODE_SHA}`,
            with: {
              'node-version': '22',
            },
          },

          // Placeholder for the future marketplace action (AC-U6).
          // Commented out — the runner is invoked in-repo below.
          // # uses: devdigest/review-action@v1

          {
            name: 'Run DevDigest Review',
            run: `node ${RUNNER_PATH}`,
            env: {
              // Secret references only — actual values are never interpolated (AC-U5).
              OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}',
              GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
              // GitHub Actions context vars (AC-UN5 / env contract from agent-runner/src/context.ts).
              GITHUB_REPOSITORY: '${{ github.repository }}',
              PR_NUMBER: '${{ github.event.pull_request.number }}',
              // Publish mode — literal from input; `none` posts nothing (AC-O3).
              DEVDIGEST_POST_AS: input.postAs,
              // Base directory for .devdigest content (matches agent-runner/src/index.ts).
              DEVDIGEST_DIR: '${{ github.workspace }}/.devdigest',
              // Default result path (matches agent-runner/src/index.ts).
              DEVDIGEST_RESULT_PATH: RESULT_FILE,
            },
          },

          {
            name: 'Upload DevDigest Result',
            // Runs even when post_as=none so ingest still receives the artifact (AC-O3).
            if: 'always()',
            // Pinned to full commit SHA (AC-U6).
            uses: `actions/upload-artifact@${UPLOAD_ARTIFACT_SHA}`,
            with: {
              name: 'devdigest-result',
              path: RESULT_FILE,
              'if-no-files-found': 'warn',
            },
          },

          {
            name: 'Ingest result into DevDigest Studio',
            // Best-effort — must run and never fail the job (AC-E7, AC-UN4).
            if: 'always()',
            env: {
              // Studio URL comes only from the repo Variable set during
              // provisioning — never a raw literal baked into the workflow
              // (AC-U7). Empty when provisioning hasn't run — the script
              // below no-ops in that case (AC-ST2).
              [DEVDIGEST_STUDIO_URL_VAR]: `\${{ vars.${DEVDIGEST_STUDIO_URL_VAR} }}`,
              // Token reference only, never a raw value (AC-U7).
              CI_INGEST_TOKEN: '${{ secrets.CI_INGEST_TOKEN }}',
              PR_REPOSITORY: '${{ github.repository }}',
              PR_HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
            },
            run: [
              `if [ -z "$${DEVDIGEST_STUDIO_URL_VAR}" ]; then`,
              `  echo "${DEVDIGEST_STUDIO_URL_VAR} not set; skipping ingest."`,
              '  exit 0',
              'fi',
              'if ! command -v jq >/dev/null 2>&1; then',
              '  echo "jq not found; skipping ingest."',
              '  exit 0',
              'fi',
              'PAYLOAD="$(jq -c --arg repo "$PR_REPOSITORY" --arg sha "$PR_HEAD_SHA" \'. + {repository: $repo, commit_sha: $sha}\' ' +
                `${RESULT_FILE} 2>/dev/null || echo "")"`,
              'if [ -z "$PAYLOAD" ]; then',
              '  echo "Could not build ingest payload; skipping."',
              '  exit 0',
              'fi',
              `curl -s -X POST "$${DEVDIGEST_STUDIO_URL_VAR}/ci/ingest" \\`,
              '  -H "Authorization: Bearer $CI_INGEST_TOKEN" \\',
              '  -H "Content-Type: application/json" \\',
              '  --data-binary "$PAYLOAD" \\',
              '  || true',
            ].join('\n'),
          },
        ],
      },
    },
  };

  return yamlStringify(workflow, { lineWidth: 0 });
}
