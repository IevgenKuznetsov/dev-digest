import type { Container } from '../../platform/container.js';
import { NotFoundError, AppError, ValidationError } from '../../platform/errors.js';
import {
  AgentManifest,
  type CiExport,
  type CiInstallation,
  type CiInstallationView,
  type CiRun,
  type CiResultArtifact,
  type AgentPerformance,
  type PerfWindow,
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
  acceptRate,
  costDelta,
  trendArrow,
  toCostSlices,
  emptyPerformance,
  validateWorkflowOverride,
} from './helpers.js';
import { generateWorkflow } from './workflow.js';
import {
  CI_BRANCH,
  WORKFLOW_PATH,
  CI_INGEST_TOKEN_KEY,
  DEVDIGEST_STUDIO_URL_VAR,
  DEFAULT_STUDIO_URL,
} from './constants.js';
import type { ExportBody } from './routes.js';

// Row type for a matched installation (returned from findInstallationByRepo).
type InstallationRow = NonNullable<
  Awaited<ReturnType<CiRepository['findInstallationByRepo']>>
>;

/**
 * Ingest-wiring provisioning outcome (Step 8). Not part of the vendor/shared
 * `CiExport` contract — `POST /agents/:id/export-ci` has no response schema
 * in `routes.ts`, so this extra field passes through unmodified and callers
 * that only care about `CiExport`'s fields are unaffected.
 */
export interface IngestWiring {
  /**
   * 'ok' = secret + variable provisioned; 'skipped' = action !== 'open_pr'
   * (no PR/repo to provision against); 'incomplete' = provisioning was
   * attempted but failed (AC-UN2 — never a false working-round-trip claim).
   */
  status: 'ok' | 'skipped' | 'incomplete';
  error?: string;
}

export interface CiExportResult extends CiExport {
  ingest_wiring: IngestWiring;
}

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
  async exportCi(workspaceId: string, agentId: string, input: ExportBody): Promise<CiExportResult> {
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
    //    If the wizard provided an edited override, validate it preserves the
    //    generated workflow's security invariants (permissions, fork guard,
    //    self-hosted runner, no pull_request_target) before using it verbatim
    //    (AC-E3, AC-U8) — otherwise generate from input.
    if (input.workflow_override != null) {
      const violations = validateWorkflowOverride(input.workflow_override);
      if (violations.length > 0) {
        throw new AppError(
          'unsafe_workflow_override',
          `workflow_override violates required security invariants: ${violations.join('; ')}`,
          422,
        );
      }
    }
    const studioUrl = input.studio_url ?? DEFAULT_STUDIO_URL;
    const workflowYaml =
      input.workflow_override ??
      generateWorkflow({
        triggers: input.triggers,
        postAs: input.post_as,
        base: input.base,
        runnerLabel: input.runner_label,
        studioUrl,
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
    let ingestWiring: IngestWiring = { status: 'skipped' };

    if (input.action === 'open_pr') {
      // Pre-flight: the ingest step baked into the generated workflow needs a
      // bearer token to authenticate its POST to /ci/ingest. Abort before any
      // GitHub call if it isn't configured (AC-UN2 — never silently produce a
      // workflow that can't ingest results).
      const ingestToken = await this.container.secrets.get(CI_INGEST_TOKEN_KEY);
      if (!ingestToken) {
        throw new AppError(
          'ci_ingest_token_missing',
          `${CI_INGEST_TOKEN_KEY} is not configured. Set it via the secrets provider before exporting to CI.`,
          422,
        );
      }

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

      // Provision the target repo's Actions secret + variable so the
      // generated workflow's ingest step can authenticate (Step 7/8). A
      // provisioning failure must NOT fail the whole export — the PR is
      // already open — but must be surfaced as 'incomplete', never a false
      // 'ok' (AC-UN2). Never log the token value itself.
      try {
        const provisioner = await this.container.ciProvisioner();
        await provisioner.createOrUpdateActionsSecret(
          repoRef.owner,
          repoRef.name,
          CI_INGEST_TOKEN_KEY,
          ingestToken,
        );
        await provisioner.setActionsVariable(
          repoRef.owner,
          repoRef.name,
          DEVDIGEST_STUDIO_URL_VAR,
          studioUrl,
        );
        ingestWiring = { status: 'ok' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ci] Failed to provision Actions secret/variable for ${input.repo}: ${message}`,
        );
        ingestWiring = { status: 'incomplete', error: message };
      }
    }

    // 10. Insert (or update) the ci_installations row ONLY after a successful
    //     commit/PR (or for 'files'). If the GitHub steps threw, we never
    //     reach here (AC-UN3). Add-repository for an already-installed
    //     (agent, repo) pair updates the existing row instead of inserting a
    //     duplicate (AC-UN7).
    const installationRow = await this.repo.upsertInstallation({
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

    return { installation, files, pr_url: prUrl, ingest_wiring: ingestWiring };
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
    // (and agent name, required by agent_runs.agent_name) from the agent row directly.
    const agentInfo = await this.repo.getWorkspaceAndNameForAgent(installation.agentId);
    if (!agentInfo) {
      throw new ValidationError(
        `No workspace found for agent "${installation.agentId}" linked to installation "${installation.id}"`,
      );
    }
    const { workspaceId, agentName } = agentInfo;

    // 1. Insert agent_runs row with source='ci' (AC-E6).
    await this.repo.insertAgentRun({
      workspaceId,
      agentId: installation.agentId,
      agentName,
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
      status: artifact.status ?? null,
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
  // listInstallations (Step 5 — extended with latest-run join, AC-E3, AC-U5)
  // -------------------------------------------------------------------------

  async listInstallations(workspaceId: string, agentId: string): Promise<CiInstallationView[]> {
    const rows = await this.repo.listInstallationsWithLatestRun(workspaceId, agentId);
    return rows.map((r) => ({
      id: r.installation.id,
      agent_id: r.installation.agentId,
      repo: r.installation.repo,
      target_type: r.installation.targetType as CiInstallation['target_type'],
      installed_at: r.installation.installedAt.toISOString(),
      agent_version: r.installation.agentVersion ?? null,
      last_status: r.lastStatus,
      last_run_at: r.lastRunAt,
    }));
  }

  // -------------------------------------------------------------------------
  // removeInstallation (Step 5, AC-E5)
  // -------------------------------------------------------------------------

  /**
   * Remove a CI installation. Deletes only the installation row — historical
   * `ci_runs` are preserved via the existing `ON DELETE SET NULL` FK (AC-E5).
   * Ownership is enforced by workspace via the repository's join to `agents`.
   */
  async removeInstallation(id: string, workspaceId: string): Promise<void> {
    const deleted = await this.repo.deleteInstallation(id, workspaceId);
    if (!deleted) {
      throw new NotFoundError(`CI installation "${id}" not found in workspace "${workspaceId}"`);
    }
  }

  // -------------------------------------------------------------------------
  // getPerformance (Step 5, AC-U2, AC-U3, AC-E1, AC-ST1)
  // -------------------------------------------------------------------------

  /**
   * Compose the Agent Performance dashboard for the selected `{7,30,90}`-day
   * window. Cost delta and per-agent accept-rate trend compare the selected
   * window to the immediately preceding equal-length window. Returns a
   * zeroed shape when there are no runs in the window (AC-ST1).
   */
  async getPerformance(workspaceId: string, window: PerfWindow): Promise<AgentPerformance> {
    const days = Number(window);
    const msPerDay = 24 * 60 * 60 * 1000;
    const until = new Date();
    const since = new Date(until.getTime() - days * msPerDay);
    const prevUntil = since;
    const prevSince = new Date(since.getTime() - days * msPerDay);

    const totals = await this.repo.totalsForWindow(workspaceId, since, until);
    if (totals.totalRuns === 0) {
      return emptyPerformance(window);
    }

    const [prevTotals, agentRows, acceptCounts, prevAcceptCounts, costByModelRows] =
      await Promise.all([
        this.repo.totalsForWindow(workspaceId, prevSince, prevUntil),
        this.repo.aggregateAgentRuns(workspaceId, since, until),
        this.repo.acceptCountsByAgent(workspaceId, since, until),
        this.repo.acceptCountsByAgent(workspaceId, prevSince, prevUntil),
        this.repo.costByModel(workspaceId, since, until),
      ]);

    const acceptMap = new Map(acceptCounts.map((r) => [r.agentId, r]));
    const prevAcceptMap = new Map(prevAcceptCounts.map((r) => [r.agentId, r]));

    const agents = agentRows.map((row) => {
      const counts = acceptMap.get(row.agentId);
      const prevCounts = prevAcceptMap.get(row.agentId);
      const rate = acceptRate(counts?.accepted ?? 0, counts?.dismissed ?? 0);
      const prevRate = acceptRate(prevCounts?.accepted ?? 0, prevCounts?.dismissed ?? 0);

      return {
        agent_id: row.agentId,
        agent_name: row.agentName,
        runs: row.runs,
        avg_cost_usd: row.avgCostUsd,
        avg_duration_ms: row.avgDurationMs,
        accept_rate: rate,
        trend: trendArrow(rate, prevRate),
        last_run_at: row.lastRanAt,
      };
    });

    const nonNullRates = agents
      .map((a) => a.accept_rate)
      .filter((r): r is number => r !== null);
    const avgAcceptRate =
      nonNullRates.length > 0
        ? nonNullRates.reduce((sum, r) => sum + r, 0) / nonNullRates.length
        : null;

    const mostActive = agentRows.reduce<(typeof agentRows)[number] | null>(
      (max, row) => (max === null || row.runs > max.runs ? row : max),
      null,
    );

    return {
      window,
      total_runs: totals.totalRuns,
      total_cost_usd: totals.totalCostUsd,
      cost_delta_usd: costDelta(totals.totalCostUsd, prevTotals.totalCostUsd),
      avg_accept_rate: avgAcceptRate,
      most_active_agent: mostActive
        ? { agent_id: mostActive.agentId, agent_name: mostActive.agentName, runs: mostActive.runs }
        : null,
      agents,
      cost_by_agent: toCostSlices(
        agentRows.map((r) => ({ key: r.agentName, costUsd: r.totalCostUsd })),
      ),
      cost_by_model: toCostSlices(
        costByModelRows.map((r) => ({ key: r.model, costUsd: r.costUsd })),
      ),
    };
  }
}
