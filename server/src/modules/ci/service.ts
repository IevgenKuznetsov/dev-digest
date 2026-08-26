import type { Container } from '../../platform/container.js';
import { NotFoundError, AppError, ValidationError } from '../../platform/errors.js';
import {
  AgentManifest,
  type CiExport,
  type CiInstallation,
  type CiRun,
  type CiResultArtifact,
} from '@devdigest/shared';
import { CiRepository } from './repository.js';
import {
  slugify,
  assertNoDuplicateSlugs,
  manifestFromAgent,
  readRunnerBundle,
  bundleFiles,
  serializeManifest,
  parseRepoRef,
} from './helpers.js';
import { generateWorkflow } from './workflow.js';
import { CI_BRANCH, WORKFLOW_PATH } from './constants.js';
import type { ExportBody } from './routes.js';

// Row type for a matched installation (returned from findInstallationByRepo).
type InstallationRow = NonNullable<
  Awaited<ReturnType<CiRepository['findInstallationByRepo']>>
>;

/**
 * A6 — CI service.
 *
 * Business logic for the Export to CI feature:
 * - exportCi: builds the CI file bundle and opens a PR or returns files.
 * - ingest: validates and persists CI run artifacts.
 * - listRuns / listInstallations: read queries for the CI Runs page and CI tab.
 */
export class CiService {
  protected repo: CiRepository;

  constructor(protected container: Container) {
    this.repo = new CiRepository(container.db);
  }

  // -------------------------------------------------------------------------
  // exportCi (Step 5)
  // -------------------------------------------------------------------------

  /**
   * Export an agent to CI.
   *
   * 1. Load the agent and its linked skills (NotFoundError if missing).
   * 2. Build and validate the AgentManifest (abort on failure — AC-UN7, AC-U3).
   * 3. Assemble the CiFile bundle (manifest YAML, skill MDs, runner, workflow).
   * 4. Memory.jsonl: v1 omits entirely (no memory source — AC-O1 omit branch).
   * 5. Never write OPENROUTER_API_KEY into any file (AC-U5).
   * 6. For action='open_pr': commitFiles → findOpenPr / openPullRequest.
   *    On GitHub failure, propagate error and DO NOT insert installation row (AC-UN3).
   * 7. Slug collision guard — abort before any GitHub call (AC-UN7).
   * 8. Insert ci_installations row ONLY after successful commit/PR (or for 'files') (AC-U7).
   */
  async exportCi(workspaceId: string, agentId: string, input: ExportBody): Promise<CiExport> {
    // 1. Load agent + linked skills.
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) {
      throw new NotFoundError(`Agent "${agentId}" not found in workspace "${workspaceId}"`);
    }

    const linkedSkillRows = await this.container.agentsRepo.linkedSkills(agentId);

    // 2. Derive and validate skill slugs (slug collision guard — AC-UN7).
    const slugs = linkedSkillRows.map((ls) => slugify(ls.skill.name));
    assertNoDuplicateSlugs(slugs); // throws on collision — abort before any GitHub call

    // 3. Derive agent slug.
    const agentSlug = slugify(agent.name);
    if (!agentSlug) {
      throw new AppError(
        'invalid_agent_name',
        `Agent name "${agent.name}" produces an empty slug. Rename the agent before exporting.`,
        422,
      );
    }

    // 4. Build and validate the AgentManifest (AC-U3, AC-UN7).
    const manifestRaw = manifestFromAgent(agent, slugs);
    let manifest: AgentManifest;
    try {
      manifest = AgentManifest.parse(manifestRaw);
    } catch (err) {
      throw new AppError(
        'manifest_validation_error',
        `Agent manifest validation failed: ${err instanceof Error ? err.message : String(err)}. ` +
          `Fix the agent configuration before exporting.`,
        422,
      );
    }

    // 5. Serialize manifest YAML.
    const manifestYaml = serializeManifest(manifest);

    // 6. Read runner bundle (fails loudly if not built — AC-UN7 spirit).
    const runnerBundle = readRunnerBundle();

    // 7. Determine workflow YAML.
    //    If the wizard provided an edited override, use it verbatim (AC-E3, AC-U8).
    //    Otherwise generate from input.
    const workflowYaml =
      input.workflow_override ??
      generateWorkflow({
        triggers: input.triggers,
        postAs: input.post_as,
        base: input.base,
      });

    // 8. Assemble the full file bundle.
    const skillFiles = linkedSkillRows.map((ls, i) => ({
      slug: slugs[i]!,
      body: ls.skill.body ?? '',
    }));

    const files = bundleFiles({
      agentSlug,
      manifestYaml,
      skills: skillFiles,
      runnerBundle,
      workflowYaml,
      workflowPath: WORKFLOW_PATH,
    });

    // 9. Open PR or return files.
    let prUrl: string | null = null;

    if (input.action === 'open_pr') {
      // Resolve the GitHub client (may throw ConfigError if GITHUB_TOKEN missing).
      const github = await this.container.github();
      const repoRef = parseRepoRef(input.repo);

      // Commit the files to the devdigest/ci branch (atomic, overwrites existing
      // workflow, never touches main — AC-UN4).
      await github.commitFiles(repoRef, {
        branch: CI_BRANCH,
        base: input.base,
        files,
        message: `chore: export ${agent.name} agent to CI [devdigest]`,
      });

      // Reuse existing open PR if one exists (AC-E9); otherwise open a new one.
      const existingPr = await github.findOpenPr(repoRef, CI_BRANCH);
      if (existingPr) {
        prUrl = existingPr.url;
      } else {
        const newPr = await github.openPullRequest(repoRef, {
          title: `Add DevDigest CI review: ${agent.name}`,
          head: CI_BRANCH,
          base: input.base,
          body: [
            `This PR adds the **${agent.name}** review agent to your CI pipeline.`,
            '',
            'Files added:',
            `- \`.github/workflows/devdigest-review.yml\` — GitHub Actions workflow`,
            `- \`.devdigest/agents/${agentSlug}.yaml\` — agent manifest`,
            ...(skillFiles.length > 0
              ? [`- \`.devdigest/skills/\` — ${skillFiles.length} skill file(s)`]
              : []),
            `- \`.devdigest/runner/index.js\` — bundled CI runner`,
            '',
            '_Generated by [DevDigest](https://devdigest.ai)_',
          ].join('\n'),
        });
        prUrl = newPr.url;
      }
    }

    // 10. Insert ci_installations row ONLY after a successful commit/PR (or for 'files').
    //     If the GitHub steps threw, we never reach here (AC-UN3).
    const installationRow = await this.repo.insertInstallation({
      agentId,
      repo: input.repo,
      targetType: 'gha',
      agentVersion: agent.version,
    });

    // Map installation row to the CiInstallation contract shape.
    const installation: CiInstallation = {
      id: installationRow.id,
      agent_id: installationRow.agentId,
      repo: installationRow.repo,
      target_type: installationRow.targetType as CiInstallation['target_type'],
      installed_at: installationRow.installedAt.toISOString(),
    };

    return { installation, files, pr_url: prUrl };
  }

  // -------------------------------------------------------------------------
  // ingest (Step 7 + Step 8)
  // -------------------------------------------------------------------------

  /**
   * Persist an ingested CI run artifact.
   *
   * Called after token + schema + installation-match validation in the route.
   *
   * 1. Insert an agent_runs row with source='ci' (AC-E6).
   * 2. Upsert ci_runs keyed on (ci_installation_id, pr_number, commit_sha) (AC-UN6).
   *
   * Workspace is derived from the matched installation's agent — never from
   * the untrusted artifact (multi-tenant safety).
   */
  async ingest(params: {
    artifact: CiResultArtifact;
    repository: string;
    commitSha: string;
    installation: InstallationRow;
  }): Promise<void> {
    const { artifact, commitSha, installation } = params;

    // Derive workspace from the matched installation's agent (multi-tenant safety).
    // ingest has no workspace context (token-authed), so we look up the workspace
    // from the agent row directly.
    const workspaceId = await this.repo.getWorkspaceIdForAgent(installation.agentId);
    if (!workspaceId) {
      throw new ValidationError(
        `No workspace found for agent "${installation.agentId}" linked to installation "${installation.id}"`,
      );
    }

    // 1. Insert agent_runs row with source='ci' (AC-E6).
    await this.repo.insertAgentRun({
      workspaceId,
      agentId: installation.agentId,
      model: null,
      provider: null,
      durationMs: artifact.duration_ms ?? null,
      costUsd: artifact.cost_usd ?? null,
      status: null,
      findingsCount: artifact.findings_count,
    });

    // 2. Upsert ci_runs keyed on (ci_installation_id, pr_number, commit_sha) (AC-UN6).
    await this.repo.upsertCiRun({
      ciInstallationId: installation.id,
      prNumber: artifact.pr_number ?? null,
      commitSha,
      model: null,
      manifestVersion: artifact.version ?? null,
      status: null,
      findingsCount: artifact.findings_count,
      costUsd: artifact.cost_usd ?? null,
      githubUrl: null,
    });
  }

  // -------------------------------------------------------------------------
  // listRuns (Step 9)
  // -------------------------------------------------------------------------

  async listRuns(
    workspaceId: string,
    filters: { repo?: string; agentId?: string; status?: string },
  ): Promise<CiRun[]> {
    const rows = await this.repo.listRuns({
      workspaceId,
      repo: filters.repo,
      agentId: filters.agentId,
      status: filters.status,
    });

    return rows.map(({ run, agent }) => ({
      id: run.id,
      ci_installation_id: run.ciInstallationId ?? null,
      pr_number: run.prNumber ?? null,
      ran_at: run.ranAt?.toISOString() ?? null,
      status: run.status ?? null,
      findings_count: run.findingsCount ?? null,
      cost_usd: run.costUsd ?? null,
      github_url: run.githubUrl ?? null,
      source: run.source ?? null,
      agent: agent?.name ?? null,
      // ci_runs has no duration column; agent_runs.durationMs holds it but
      // lacks a FK to ci_runs. A future migration adding duration_ms to ci_runs
      // (or an agent_run_id FK) will populate this field.
      duration_s: null,
    }));
  }

  // -------------------------------------------------------------------------
  // listInstallations (Step 9)
  // -------------------------------------------------------------------------

  async listInstallations(agentId: string): Promise<
    Array<CiInstallation & { agent_version: number | null }>
  > {
    const rows = await this.repo.listInstallations(agentId);
    return rows.map((r) => ({
      id: r.id,
      agent_id: r.agentId,
      repo: r.repo,
      target_type: r.targetType as CiInstallation['target_type'],
      installed_at: r.installedAt.toISOString(),
      agent_version: r.agentVersion ?? null,
    }));
  }
}
