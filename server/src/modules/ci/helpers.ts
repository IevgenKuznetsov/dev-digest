/**
 * Pure helpers for the `ci` module.
 *
 * All functions are stateless / side-effect-free (except readRunnerBundle which
 * reads from the filesystem) so they can be unit-tested without any database or
 * network dependencies.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import type { AgentManifest, CiFile, AgentPerformance, CostSlice, PerfWindow } from '@devdigest/shared';
import type { AgentRow } from '../../db/rows.js';
import type { LinkedSkillRow } from '../agents/repository.js';
import { MANIFEST_DIR, SKILLS_DIR, RUNNER_PATH } from './constants.js';

// ---------------------------------------------------------------------------
// slugify / collision guard
// ---------------------------------------------------------------------------

/**
 * Convert a skill name to a URL-safe slug used in file paths and the manifest.
 *
 * Rules:
 * - Lower-case everything.
 * - Replace whitespace and non-alphanumeric characters (except hyphens) with hyphens.
 * - Collapse consecutive hyphens.
 * - Strip leading/trailing hyphens.
 *
 * Example: "My Skill (v2)" → "my-skill-v2"
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// studio URL validation (security)
// ---------------------------------------------------------------------------

/**
 * Validates that a caller-supplied studio URL points to a private-network
 * host, per the v2 spec invariant: the local-first studio is reachable
 * ONLY via a self-hosted GitHub Actions runner on the operator's private
 * network — never a public tunnel or hosted relay (spec Non-goals,
 * "Self-hosted runner boundary" NFR).
 *
 * Without this check, a client could set `studio_url` to an attacker-
 * controlled public host; since `CI_INGEST_TOKEN` is provisioned to that
 * same URL, the workflow's ingest step would exfiltrate the token (and
 * review artifact data) on every subsequent CI run. Rejecting non-private
 * hosts server-side closes that path while remaining fully compatible with
 * the intended self-hosted-runner deployment model.
 *
 * Allowed: `localhost`, `127.0.0.1`, `::1`, and RFC 1918 private ranges
 * (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). Scheme must be http or https.
 */
export function isPrivateNetworkStudioUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) {
    return false;
  }
  const octets = ipv4.slice(1, 5).map(Number);
  if (octets.some((o) => o < 0 || o > 255)) {
    return false;
  }
  const [a, b] = octets as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Validates that a caller-supplied `runner_label` set targets a self-hosted
 * runner, per the v2 spec invariant that the studio is reachable ONLY via a
 * self-hosted GitHub Actions runner (spec Non-goals, "Self-hosted runner
 * boundary" NFR; AC-U9).
 *
 * GitHub Actions requires the literal `self-hosted` label to be present in
 * `runs-on:` for the job to route to a self-hosted runner. Without this
 * check, a caller could set `runner_label` to `["ubuntu-latest"]` and the
 * generated workflow would silently execute on GitHub-hosted infrastructure
 * instead — defeating the "studio never internet-exposed" guarantee the rest
 * of the ingest wiring (private-network `studio_url`, `CI_INGEST_TOKEN`)
 * depends on.
 */
export function isSelfHostedRunnerLabel(labels: string[]): boolean {
  return labels.includes('self-hosted');
}

/**
 * Validates that an author-edited `workflow_override` YAML preserves the
 * generated workflow's core security invariants (AC-E3, AC-U8: the wizard
 * lets authors edit the workflow, but AC-U4/AC-UN5/AC-U9 must still hold
 * afterwards). Without this check, an author (or anything reusing this
 * endpoint) could submit a `workflow_override` that strips the fork guard,
 * widens `permissions:`, adds `pull_request_target`, or targets a
 * GitHub-hosted runner — silently bypassing every invariant `generateWorkflow`
 * otherwise enforces, since the override is used verbatim.
 *
 * Returns an array of human-readable violation messages — empty when the
 * workflow is acceptable. Does not attempt full GitHub Actions schema
 * validation; it only checks the specific invariants documented above.
 */
/**
 * Extract the set of trigger/event names from a YAML `on:` value, which
 * GitHub Actions accepts in three shapes: a bare string (`on: pull_request`),
 * an array (`on: [pull_request, push]`), or a mapping
 * (`on: { pull_request: {...} }`). Checking only the mapping shape (as an
 * earlier version of this validator did) let `on: pull_request_target` or
 * `on: [pull_request_target]` slip through undetected.
 */
function triggerNames(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.filter((x): x is string => typeof x === 'string');
  if (on && typeof on === 'object') return Object.keys(on as Record<string, unknown>);
  return [];
}

const PERMISSION_ALLOWED_SCOPES = new Set(['contents', 'pull-requests']);

/**
 * Validate a single `permissions:` value (top-level or job-level — GitHub
 * Actions allows a job's `permissions:` to override the workflow-level
 * block, so both must be checked identically). Pushes violation messages
 * with the given `context` prefix. Does NOT handle the "block is entirely
 * absent" case — callers decide whether that's required (top-level) or
 * acceptable as inheriting the parent (job-level).
 */
function checkPermissionsValue(permissions: unknown, context: string, violations: string[]): void {
  if (permissions === null) {
    violations.push(
      `${context} "permissions" must not be empty/null — declare only the specific scopes needed`,
    );
    return;
  }
  if (permissions === 'write-all' || permissions === 'read-all') {
    violations.push(
      `${context} "permissions" must not use "write-all"/"read-all" — declare only the specific scopes needed`,
    );
    return;
  }
  if (typeof permissions === 'object' && !Array.isArray(permissions)) {
    for (const [scope, level] of Object.entries(permissions as Record<string, unknown>)) {
      if (!PERMISSION_ALLOWED_SCOPES.has(scope)) {
        violations.push(
          `${context} "permissions" grants unexpected scope "${scope}" — only "contents" and "pull-requests" are permitted`,
        );
      } else if (scope === 'contents' && level !== 'read') {
        violations.push(`${context} "permissions.contents" must be "read"`);
      }
    }
    return;
  }
  violations.push(`${context} "permissions" has an unrecognized shape`);
}

/**
 * The only accepted fork-PR guard expression, normalized (whitespace and
 * the optional `${{ }}` wrapper stripped). Matched by exact equality rather
 * than substring — `jobIf.includes('head.repo.fork')` previously accepted
 * tautologies like `if: "true || ...head.repo.fork == false"`, which run
 * unconditionally (including on forked PRs) while still containing the
 * substring.
 */
const FORK_GUARD_EXPRESSION = 'github.event.pull_request.head.repo.fork==false';

export function validateWorkflowOverride(yamlText: string): string[] {
  const violations: string[] = [];

  let doc: unknown;
  try {
    doc = yamlParse(yamlText);
  } catch {
    return ['workflow_override is not valid YAML'];
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['workflow_override must be a YAML mapping'];
  }
  const root = doc as Record<string, unknown>;

  // 1. No `pull_request_target` — it grants secrets to untrusted fork code
  //    (AC-UN5 spirit; the fork `if` guard on `pull_request` is the intended
  //    mechanism instead). Checked across all three `on:` shapes.
  if (triggerNames(root['on']).includes('pull_request_target')) {
    violations.push(
      'workflow must not use the "pull_request_target" trigger (grants secrets to untrusted fork PR code)',
    );
  }

  // 2. Top-level permissions block must be explicit and least-privilege
  //    (AC-U4). `permissions: null` (an empty `permissions:` key) is treated
  //    the same as a fully absent block, not as "no violation".
  const permissions = root['permissions'];
  if (permissions === undefined || permissions === null) {
    violations.push(
      'workflow must declare an explicit top-level "permissions" block (no implicit default token permissions)',
    );
  } else {
    checkPermissionsValue(permissions, 'workflow', violations);
  }

  // 3. Every job must run on a self-hosted runner (AC-U9), keep the fork
  //    guard (AC-UN5), and must not use a job-level `permissions:` override
  //    to escalate beyond what the top-level block allows (GitHub Actions
  //    lets a job's `permissions:` override the workflow-level one).
  const jobs = root['jobs'];
  const jobEntries =
    jobs && typeof jobs === 'object' ? Object.entries(jobs as Record<string, unknown>) : [];
  if (jobEntries.length === 0) {
    violations.push('workflow must define at least one job');
  }
  for (const [jobName, jobRaw] of jobEntries) {
    const job = (jobRaw ?? {}) as Record<string, unknown>;

    const runsOn = job['runs-on'];
    const runsOnLabels = Array.isArray(runsOn)
      ? (runsOn as unknown[])
      : typeof runsOn === 'string'
        ? [runsOn]
        : [];
    if (!runsOnLabels.includes('self-hosted')) {
      violations.push(
        `job "${jobName}" must run on a self-hosted runner ("runs-on" must include "self-hosted")`,
      );
    }

    const jobIfRaw = typeof job['if'] === 'string' ? (job['if'] as string) : '';
    const normalizedIf = jobIfRaw.replace(/\$\{\{|\}\}/g, '').replace(/\s+/g, '');
    if (normalizedIf !== FORK_GUARD_EXPRESSION) {
      violations.push(
        `job "${jobName}" is missing the required fork-PR guard ` +
          `("if" must be exactly "\${{ github.event.pull_request.head.repo.fork == false }}")`,
      );
    }

    if (job['permissions'] !== undefined) {
      checkPermissionsValue(job['permissions'], `job "${jobName}"`, violations);
    }
  }

  return violations;
}

/**
 * Guard against two skills producing the same slug.
 *
 * Throws a descriptive error when a collision is detected so the export can
 * abort before any GitHub API calls are made (AC-UN7).
 */
export function assertNoDuplicateSlugs(slugs: string[]): void {
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (seen.has(slug)) {
      throw new Error(
        `Slug collision: two or more skills resolve to the same slug "${slug}". ` +
          `Rename one skill so all slugs are unique before exporting.`,
      );
    }
    seen.add(slug);
  }
}

// ---------------------------------------------------------------------------
// Manifest builder
// ---------------------------------------------------------------------------

/**
 * Build an AgentManifest-shaped plain object from an agent row and resolved skill slugs.
 *
 * IMPORTANT: caller must still validate with `AgentManifest.parse(...)` before
 * serializing. This function only shapes the data.
 *
 * Never places secrets into the manifest (AC-U5).
 */
export function manifestFromAgent(
  agent: AgentRow,
  skillSlugs: string[],
): AgentManifest {
  return {
    name: agent.name,
    // Provider defaults to 'openrouter' — AgentManifest.parse handles the default.
    provider: (agent.provider as AgentManifest['provider']) ?? 'openrouter',
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: skillSlugs,
    strategy: (agent.strategy as AgentManifest['strategy']) ?? 'auto',
    ci_fail_on: (agent.ciFailOn as AgentManifest['ci_fail_on']) ?? 'critical',
  };
}

// ---------------------------------------------------------------------------
// Runner bundle reader
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to the agent-runner ncc bundle.
 *
 * The bundle lives at `agent-runner/dist/index.js` relative to the mono-repo
 * root. We compute the root by walking up from this source file's location:
 *   server/src/modules/ci/helpers.ts → server/src/modules/ci → server/src/modules
 *   → server/src → server → <repo-root>
 */
function repoRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // Walk up: helpers.ts → ci/ → modules/ → src/ → server/ → repo root
  return path.resolve(path.dirname(thisFile), '..', '..', '..', '..', '..');
}

/**
 * Read the bundled agent-runner from `agent-runner/dist/index.js`.
 *
 * Fails loudly (throws) if the bundle is missing — this prevents a broken
 * export from silently writing an empty runner file (AC-UN7 spirit).
 */
export function readRunnerBundle(): string {
  const bundlePath = path.join(repoRoot(), 'agent-runner', 'dist', 'index.js');
  if (!existsSync(bundlePath)) {
    throw new Error(
      `agent-runner bundle not found at "${bundlePath}". ` +
        `Run \`cd agent-runner && npm run build\` to generate it before exporting.`,
    );
  }
  return readFileSync(bundlePath, 'utf8');
}

// ---------------------------------------------------------------------------
// File bundle builder
// ---------------------------------------------------------------------------

export interface BundleFilesInput {
  agentSlug: string;
  manifestYaml: string;
  skills: Array<{ slug: string; body: string }>;
  runnerBundle: string;
  workflowYaml: string;
  workflowPath: string;
}

/**
 * Assemble the full set of `CiFile` entries for the export bundle.
 *
 * File editability follows AC-U8:
 * - workflow: `editable: true`  (the wizard lets authors edit it)
 * - manifest / skills / runner: `editable: false`
 *
 * Memory.jsonl seam: v1 has no memory source, so no memory CiFile is emitted
 * here (AC-O1 omit branch). When a memory store is wired, push a CiFile with
 * `path: MEMORY_PATH` and `editable: false` into the returned array.
 */
export function bundleFiles(input: BundleFilesInput): CiFile[] {
  const files: CiFile[] = [];

  // Agent manifest YAML (AC-U3).
  files.push({
    path: `${MANIFEST_DIR}/${input.agentSlug}.yaml`,
    contents: input.manifestYaml,
    editable: false,
  });

  // Skill markdown files (one per linked skill).
  for (const skill of input.skills) {
    files.push({
      path: `${SKILLS_DIR}/${skill.slug}.md`,
      contents: skill.body,
      editable: false,
    });
  }

  // Bundled runner (ncc output) — never edited by the author.
  files.push({
    path: RUNNER_PATH,
    contents: input.runnerBundle,
    editable: false,
  });

  // GitHub Actions workflow — editable:true so the wizard lets authors tweak it
  // before the commit (AC-U8, AC-E3).
  files.push({
    path: input.workflowPath,
    contents: input.workflowYaml,
    editable: true,
  });

  // ---- Memory seam (AC-O1) ------------------------------------------------
  // v1: no memory store registered — omit the memory.jsonl CiFile entirely.
  // When a memory source is available, uncomment and populate:
  //   const memoryBody = await loadAgentMemory(agentId);
  //   if (memoryBody) {
  //     files.push({ path: MEMORY_PATH, contents: memoryBody, editable: false });
  //   }
  // -------------------------------------------------------------------------

  return files;
}

// ---------------------------------------------------------------------------
// AgentManifest YAML serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a validated `AgentManifest` to a YAML string using the `yaml`
 * package. The result is written to `.devdigest/agents/<slug>.yaml`.
 *
 * `AgentManifest.parse(manifest)` MUST be called by the caller BEFORE this
 * function (AC-U3, AC-UN7).
 */
export function serializeManifest(manifest: AgentManifest): string {
  return yamlStringify(manifest, { lineWidth: 0 });
}

// ---------------------------------------------------------------------------
// RepoRef helper
// ---------------------------------------------------------------------------

/**
 * Split "owner/name" into a `{ owner, name }` RepoRef.
 * The format is validated by the route schema — this just splits.
 */
export function parseRepoRef(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split('/', 2) as [string, string];
  return { owner, name };
}

// ---------------------------------------------------------------------------
// Agent Performance dashboard shaping (DB-free)
// ---------------------------------------------------------------------------

/**
 * Accept rate over local review findings: `accepted / (accepted + dismissed)`.
 *
 * Returns `null` when there is no accepted/dismissed data at all — never a
 * misleading 0% (AC-U3, AC-UN8, no divide-by-zero).
 */
export function acceptRate(accepted: number, dismissed: number): number | null {
  const total = accepted + dismissed;
  if (total === 0) return null;
  return accepted / total;
}

/**
 * Signed delta between the current and immediately preceding window's cost.
 *
 * When the previous window is `0`, a percentage-style delta is undefined —
 * return the current value as the (unsigned) delta rather than dividing by
 * zero (Edge 4). When both are `0`, the delta is `0`.
 */
export function costDelta(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : current;
  }
  return current - previous;
}

/**
 * Compare a metric across the current and previous window to derive a trend
 * arrow. Returns `null` when either side is `null` (insufficient data —
 * AC-UN8 spirit: never fabricate a trend from missing data).
 */
export function trendArrow(
  current: number | null,
  previous: number | null,
): 'up' | 'down' | 'flat' | null {
  if (current === null || previous === null) return null;
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'flat';
}

/**
 * Shape raw {key, costUsd} rows into `CostSlice[]` for donut charts, sorted
 * descending by cost so the largest slice renders first.
 */
export function toCostSlices(rows: Array<{ key: string; costUsd: number }>): CostSlice[] {
  return rows
    .map((r) => ({ key: r.key, cost_usd: r.costUsd }))
    .sort((a, b) => b.cost_usd - a.cost_usd);
}

/**
 * Zeroed `AgentPerformance` shape for the empty state (AC-ST1) — no runs in
 * the selected window.
 */
export function emptyPerformance(window: PerfWindow): AgentPerformance {
  return {
    window,
    total_runs: 0,
    total_cost_usd: 0,
    cost_delta_usd: null,
    avg_accept_rate: null,
    most_active_agent: null,
    agents: [],
    cost_by_agent: [],
    cost_by_model: [],
  };
}
