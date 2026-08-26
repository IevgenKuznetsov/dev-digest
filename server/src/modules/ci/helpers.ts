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
import { stringify as yamlStringify } from 'yaml';
import type { AgentManifest, CiFile } from '@devdigest/shared';
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
