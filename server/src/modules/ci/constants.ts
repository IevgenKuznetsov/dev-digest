/**
 * Constants for the `ci` module.
 *
 * Pinned action SHAs were resolved on 2026-08-25 via the GitHub API.
 * Each SHA corresponds to the v4 tag HEAD of the respective action.
 * Update these when adopting a new major/minor version of an action.
 */

// ---- Secret key name -------------------------------------------------------

/** Key used in SecretsProvider to read the CI ingest bearer token. */
export const CI_INGEST_TOKEN_KEY = 'CI_INGEST_TOKEN';

// ---- Branch / paths --------------------------------------------------------

/** The dedicated branch used for all CI export commits. Never main. */
export const CI_BRANCH = 'devdigest/ci';

/** Path of the generated GitHub Actions workflow inside the target repo. */
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';

/** Directory where agent manifest YAML files live inside the target repo. */
export const MANIFEST_DIR = '.devdigest/agents';

/** Directory where skill markdown files live inside the target repo. */
export const SKILLS_DIR = '.devdigest/skills';

/** Path to the bundled agent-runner inside the target repo. */
export const RUNNER_PATH = '.devdigest/runner/index.js';

/** Optional memory file for agents that have conversation memory. */
export const MEMORY_PATH = '.devdigest/memory.jsonl';

/** Artifact filename uploaded by the CI action and ingested by the studio. */
export const RESULT_FILE = 'devdigest-result.json';

// ---- Pinned action SHAs (resolved 2026-08-25) ------------------------------

/**
 * Full commit SHA for `actions/checkout@v4`.
 * Source: https://api.github.com/repos/actions/checkout/git/refs/tags/v4
 */
export const CHECKOUT_SHA = '11d5960a326750d5838078e36cf38b85af677262';

/**
 * Full commit SHA for `actions/setup-node@v4`.
 * Source: https://api.github.com/repos/actions/setup-node/git/refs/tags/v4
 */
export const SETUP_NODE_SHA = '49933ea5288caeca8642d1e84afbd3f7d6820020';

/**
 * Full commit SHA for `actions/upload-artifact@v4`.
 * Source: https://api.github.com/repos/actions/upload-artifact/git/refs/tags/v4
 */
export const UPLOAD_ARTIFACT_SHA = 'ea165f8d65b6e75b540449e92b4886f43607fa02';
