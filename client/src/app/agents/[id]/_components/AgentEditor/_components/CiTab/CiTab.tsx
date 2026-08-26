/* CiTab — CI management tab in the agent editor (AC-E8, AC-E1).
   Renders CI installations (with installed workflow version), run history,
   and the "Fail CI on" setting. Provides an "Add to CI" button that opens
   the Export Wizard modal. */
"use client";

import React from "react";
import { Button, Skeleton, EmptyState } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import type { CiInstallation, CiRun } from "@devdigest/shared";
import { useCiInstallations, useCiRuns } from "@/lib/hooks/ci";
import { CiExportWizard } from "@/components/CiExportWizard";
import {
  WORKFLOW_VERSION_LABEL,
  CI_FAIL_ON_LABEL,
  RUN_HISTORY_SKELETON_ROWS,
  CI_FAIL_ON_LABELS,
} from "./constants";

// ---------------------------------------------------------------------------
// Extended CiInstallation type — the server returns agent_version in addition
// to the base contract fields (vendor/shared/contracts/eval-ci.ts is read-only,
// so we extend the type locally for the tab's display needs).
// ---------------------------------------------------------------------------
type CiInstallationWithVersion = CiInstallation & { agent_version?: number | null };

// ---------------------------------------------------------------------------
// InstallationCard — renders one ci_installations row
// ---------------------------------------------------------------------------

function InstallationCard({ installation }: { installation: CiInstallationWithVersion }) {
  const installedDate = new Date(installation.installed_at).toLocaleDateString();
  const agentVersion = installation.agent_version;

  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 9,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Repo */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "monospace",
            color: "var(--text-primary)",
          }}
        >
          {installation.repo}
        </span>
        <span
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 99,
            background: "var(--bg-hover)",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {installation.target_type}
        </span>
      </div>

      {/* Metadata row */}
      <div
        style={{
          display: "flex",
          gap: 20,
          fontSize: 12,
          color: "var(--text-muted)",
          flexWrap: "wrap",
        }}
      >
        <span>Installed {installedDate}</span>
        {/* Installed workflow version — agent version at install time (AC-E8) */}
        {agentVersion != null && (
          <span>
            {WORKFLOW_VERSION_LABEL}: <strong>v{agentVersion}</strong>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunRow — renders one ci_run row in the run history
// ---------------------------------------------------------------------------

function RunRow({ run }: { run: CiRun }) {
  const statusColor =
    run.status === "succeeded"
      ? "var(--ok, #22c55e)"
      : run.status === "failed"
        ? "var(--error, #ef4444)"
        : run.status === "running"
          ? "var(--accent)"
          : "var(--text-muted)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderRadius: 7,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        fontSize: 13,
        flexWrap: "wrap",
      }}
    >
      {/* PR number */}
      <span style={{ fontWeight: 600, minWidth: 40 }}>
        {run.pr_number != null ? `#${run.pr_number}` : "—"}
      </span>

      {/* Status badge */}
      <span
        style={{
          padding: "2px 10px",
          borderRadius: 99,
          fontSize: 11,
          fontWeight: 700,
          color: "#fff",
          background: statusColor,
        }}
      >
        {run.status ?? "—"}
      </span>

      {/* Findings */}
      <span style={{ color: "var(--text-muted)" }}>
        {run.findings_count != null ? `${run.findings_count} findings` : "—"}
      </span>

      {/* Duration */}
      <span style={{ color: "var(--text-muted)" }}>
        {run.duration_s != null ? `${run.duration_s.toFixed(1)}s` : ""}
      </span>

      {/* Cost */}
      <span style={{ color: "var(--text-muted)" }}>
        {run.cost_usd != null ? `$${run.cost_usd.toFixed(4)}` : ""}
      </span>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Trace/job link */}
      {run.github_url && (
        <a
          href={run.github_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, color: "var(--accent)" }}
        >
          View job
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CiTab — main tab component
// ---------------------------------------------------------------------------

export function CiTab({ agent }: { agent: Agent }) {
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const {
    data: installations,
    isLoading: installationsLoading,
    error: installationsError,
  } = useCiInstallations(agent.id);

  const {
    data: runs,
    isLoading: runsLoading,
    error: runsError,
  } = useCiRuns({ agent: agent.id });

  // ---------------------------------------------------------------------------
  // Installations section
  // ---------------------------------------------------------------------------

  function renderInstallations() {
    if (installationsError) {
      return (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            padding: "12px 0",
          }}
        >
          Failed to load installations.
        </div>
      );
    }

    if (installationsLoading) {
      return <Skeleton height={80} />;
    }

    if (!installations || installations.length === 0) {
      return (
        <EmptyState
          icon="Workflow"
          title="Not deployed to CI yet"
          body={`Click "Add to CI" to open a pull request that adds the workflow and agent config to a target repo.`}
        />
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(installations as CiInstallationWithVersion[]).map((inst) => (
          <InstallationCard key={inst.id} installation={inst} />
        ))}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Run history section
  // ---------------------------------------------------------------------------

  function renderRuns() {
    if (runsError) {
      return (
        <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
          Failed to load run history.
        </div>
      );
    }

    if (runsLoading) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {Array.from({ length: RUN_HISTORY_SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} height={44} />
          ))}
        </div>
      );
    }

    if (!runs || runs.length === 0) {
      return (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            padding: "12px 0",
            textAlign: "center",
          }}
        >
          No CI runs yet. Once you export this agent to CI, every automated review appears here.
        </div>
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // ci_fail_on section
  // ---------------------------------------------------------------------------

  const failOnLabel = agent.ci_fail_on
    ? (CI_FAIL_ON_LABELS[agent.ci_fail_on] ?? agent.ci_fail_on)
    : "Not configured";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 28,
        padding: "24px 28px",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 700,
              margin: 0,
            }}
          >
            Continuous Integration
          </h2>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Run this agent automatically on pull requests in a target repository.
          </div>
        </div>
        {/* Add to CI button (AC-E1) */}
        <Button
          kind="primary"
          size="sm"
          icon="Workflow"
          onClick={() => setWizardOpen(true)}
        >
          Add to CI
        </Button>
      </div>

      {/* Fail CI on setting */}
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-muted)",
            marginBottom: 6,
          }}
        >
          {CI_FAIL_ON_LABEL}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{failOnLabel}</div>
      </div>

      {/* Installations section */}
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-muted)",
            marginBottom: 10,
          }}
        >
          Installations
        </div>
        {renderInstallations()}
      </div>

      {/* Run history section */}
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-muted)",
            marginBottom: 10,
          }}
        >
          Run History
        </div>
        {renderRuns()}
      </div>

      {/* Export Wizard modal (AC-E1, Step 11) */}
      {wizardOpen && (
        <CiExportWizard
          agentId={agent.id}
          agentName={agent.name}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
