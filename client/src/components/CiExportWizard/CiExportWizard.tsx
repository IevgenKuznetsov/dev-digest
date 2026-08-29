/* CiExportWizard — 4-step Export to CI modal wizard.
   Steps: 1.Target → 2.Preview → 3.Configure → 4.Install
   Shared by the agent CI tab and any entry point that opens it. */
"use client";

import React from "react";
import { Modal } from "@devdigest/ui";
import { ExportWizardSteps } from "@devdigest/ui";
import { useExportCi } from "../../lib/hooks/ci";
import type { CiExportResult } from "../../lib/hooks/ci";
import { ApiError } from "../../lib/api";
import {
  WIZARD_LABELS,
  TARGET_CARDS,
  AVAILABLE_TRIGGERS,
  PUBLISH_MODES,
  DEFAULT_RUNNER_LABEL_INPUT,
  DEFAULT_STUDIO_URL_INPUT,
} from "./constants";
import { buildZip, triggerDownload, extractWorkflowYaml, parseRunnerLabel } from "./helpers";
import type { CiFile, CiExportInputBody } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CiExportWizardProps {
  agentId: string;
  agentName?: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Step 1: Target selection (AC-ST1, AC-E1)
// ---------------------------------------------------------------------------

function StepTarget({
  onNext,
}: {
  onNext: () => void;
}) {
  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: 16, fontSize: 14, color: "var(--text-secondary)" }}>
        Select the CI system to export your agent to.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {TARGET_CARDS.map((card) => (
          <div
            key={card.key}
            onClick={card.enabled ? onNext : undefined}
            style={{
              border: `1.5px solid ${card.enabled ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 10,
              padding: "14px 18px",
              cursor: card.enabled ? "pointer" : "not-allowed",
              opacity: card.enabled ? 1 : 0.45,
              background: card.enabled ? "var(--bg-elevated)" : "var(--bg-surface)",
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{card.label}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                {card.description}
              </div>
            </div>
            {card.enabled && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--accent)",
                  background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                  borderRadius: 99,
                  padding: "3px 10px",
                }}
              >
                Selected
              </span>
            )}
            {!card.enabled && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Coming soon</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Preview (AC-E2, AC-E3, AC-O1)
// ---------------------------------------------------------------------------

function StepPreview({
  agentId,
  repo,
  triggers,
  postAs,
  workflowYaml,
  onWorkflowYamlChange,
  previewFiles,
  isLoadingPreview,
  onLoadPreview,
}: {
  agentId: string;
  repo: string;
  triggers: string[];
  postAs: string;
  workflowYaml: string;
  onWorkflowYamlChange: (v: string) => void;
  previewFiles: CiFile[];
  isLoadingPreview: boolean;
  onLoadPreview: () => void;
}) {
  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        Review the generated files. Edit the workflow YAML below — your edits will be
        used verbatim on install.
      </div>

      {/* Load preview button */}
      {previewFiles.length === 0 && (
        <button
          onClick={onLoadPreview}
          disabled={isLoadingPreview || !repo}
          style={{
            padding: "8px 16px",
            borderRadius: 7,
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            cursor: isLoadingPreview || !repo ? "not-allowed" : "pointer",
            fontSize: 13,
            fontWeight: 600,
            opacity: isLoadingPreview || !repo ? 0.6 : 1,
          }}
        >
          {isLoadingPreview ? "Loading…" : "Load Preview"}
        </button>
      )}

      {/* File list */}
      {previewFiles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Files
          </div>
          {previewFiles.map((f) => (
            <div
              key={f.path}
              style={{
                fontSize: 12,
                fontFamily: "monospace",
                padding: "5px 10px",
                borderRadius: 5,
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{f.path}</span>
              {f.editable && (
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>editable</span>
              )}
            </div>
          ))}

          {/* Memory row — v1 always shows "No memory data" since none is emitted (AC-O1) */}
          <div
            style={{
              fontSize: 12,
              fontFamily: "monospace",
              padding: "5px 10px",
              borderRadius: 5,
              background: "var(--bg-surface)",
              border: "1px dashed var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              opacity: 0.6,
            }}
          >
            <span>.devdigest/memory.jsonl</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>No memory data</span>
          </div>
        </div>
      )}

      {/* Editable workflow YAML */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          Workflow YAML
        </div>
        <textarea
          aria-label="Workflow YAML"
          value={workflowYaml}
          onChange={(e) => onWorkflowYamlChange(e.target.value)}
          rows={12}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: 12,
            borderRadius: 7,
            border: "1px solid var(--border-strong)",
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
            padding: "10px 12px",
            resize: "vertical",
            boxSizing: "border-box",
          }}
          placeholder="Workflow YAML will appear here after loading preview…"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Configure (AC-O2, AC-O3)
// ---------------------------------------------------------------------------

function StepConfigure({
  repo,
  onRepoChange,
  triggers,
  onTriggersChange,
  postAs,
  onPostAsChange,
  runnerLabel,
  onRunnerLabelChange,
  studioUrl,
  onStudioUrlChange,
}: {
  repo: string;
  onRepoChange: (v: string) => void;
  triggers: string[];
  onTriggersChange: (v: string[]) => void;
  postAs: string;
  onPostAsChange: (v: string) => void;
  runnerLabel: string;
  onRunnerLabelChange: (v: string) => void;
  studioUrl: string;
  onStudioUrlChange: (v: string) => void;
}) {
  function toggleTrigger(key: string) {
    onTriggersChange(
      triggers.includes(key) ? triggers.filter((t) => t !== key) : [...triggers, key],
    );
  }

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Repository */}
      <div>
        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
          Target Repository <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(owner/name)</span>
        </label>
        <input
          type="text"
          aria-label="Repository"
          value={repo}
          onChange={(e) => onRepoChange(e.target.value)}
          placeholder="owner/repo-name"
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 7,
            border: "1px solid var(--border-strong)",
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
            fontSize: 13,
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Triggers (AC-O2) */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>PR Triggers</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {AVAILABLE_TRIGGERS.map((t) => (
            <label
              key={t.key}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={triggers.includes(t.key)}
                onChange={() => toggleTrigger(t.key)}
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      {/* Publish mode (AC-O3) */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Publish Mode</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {PUBLISH_MODES.map((m) => (
            <label
              key={m.key}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}
            >
              <input
                type="radio"
                name="post_as"
                value={m.key}
                checked={postAs === m.key}
                onChange={() => onPostAsChange(m.key)}
              />
              {m.label}
            </label>
          ))}
        </div>
      </div>

      {/* Self-hosted runner label (AC-U9, AC-E4b) */}
      <div>
        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
          Self-hosted Runner Label{" "}
          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(comma-separated)</span>
        </label>
        <input
          type="text"
          aria-label="Self-hosted Runner Label"
          value={runnerLabel}
          onChange={(e) => onRunnerLabelChange(e.target.value)}
          placeholder={DEFAULT_RUNNER_LABEL_INPUT}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 7,
            border: "1px solid var(--border-strong)",
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
            fontSize: 13,
            boxSizing: "border-box",
          }}
        />
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
          Sets the workflow&apos;s <code>runs-on:</code> label set.
        </div>
      </div>

      {/* Studio URL (AC-U7, AC-E4b, AC-E6) */}
      <div>
        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
          Studio URL
        </label>
        <input
          type="text"
          aria-label="Studio URL"
          value={studioUrl}
          onChange={(e) => onStudioUrlChange(e.target.value)}
          placeholder={DEFAULT_STUDIO_URL_INPUT}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 7,
            border: "1px solid var(--border-strong)",
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
            fontSize: 13,
            boxSizing: "border-box",
          }}
        />
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
          Provisioned into the target repo as the <code>DEVDIGEST_STUDIO_URL</code> Actions
          variable, reachable from the self-hosted runner over your private network.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Install (AC-E4, AC-E5, AC-ST2, AC-UN3)
// ---------------------------------------------------------------------------

function StepInstall({
  repo,
  isPending,
  error,
  errorCode,
  result,
  onInstallPr,
  onInstallZip,
}: {
  repo: string;
  isPending: boolean;
  error: string | null;
  errorCode: string | null;
  result: CiExportResult | null;
  onInstallPr: () => void;
  onInstallZip: () => void;
}) {
  const isPreflightTokenError = errorCode === "ci_ingest_token_missing";

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
        Choose how to install the agent workflow into <strong>{repo || "(no repo set)"}</strong>.
      </div>

      {/* Pre-flight ingest token error (AC-O2) — distinct from a generic export failure */}
      {error && isPreflightTokenError && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--error, #ef4444) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error, #ef4444) 30%, transparent)",
            fontSize: 13,
            color: "var(--text-primary)",
          }}
        >
          <strong>Studio CI_INGEST_TOKEN not configured:</strong> {error} Set{" "}
          <code>CI_INGEST_TOKEN</code> in the studio&apos;s secrets before opening a PR — no
          placeholder secret will be provisioned into the target repo.
        </div>
      )}

      {/* Generic error surface (AC-UN3) */}
      {error && !isPreflightTokenError && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--error, #ef4444) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error, #ef4444) 30%, transparent)",
            fontSize: 13,
            color: "var(--text-primary)",
          }}
        >
          <strong>Export failed:</strong> {error}
        </div>
      )}

      {/* PR result */}
      {result?.pr_url && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--ok, #22c55e) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--ok, #22c55e) 30%, transparent)",
            fontSize: 13,
          }}
        >
          PR opened:{" "}
          <a href={result.pr_url} target="_blank" rel="noopener noreferrer">
            {result.pr_url}
          </a>
        </div>
      )}

      {/* Provisioning outcome — structured server result (AC-E6, AC-UN2) */}
      {result?.pr_url && result.ingest_wiring.status === "ok" && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--ok, #22c55e) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--ok, #22c55e) 30%, transparent)",
            fontSize: 13,
          }}
        >
          Ingest wiring configured — <code>CI_INGEST_TOKEN</code> and{" "}
          <code>DEVDIGEST_STUDIO_URL</code> were provisioned into the target repo.
        </div>
      )}
      {result?.pr_url && result.ingest_wiring.status === "incomplete" && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--warn, #f59e0b) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--warn, #f59e0b) 30%, transparent)",
            fontSize: 13,
          }}
        >
          <strong>PR opened, but ingest wiring is incomplete.</strong>
          {result.ingest_wiring.error ? ` ${result.ingest_wiring.error}` : ""} Live CI runs
          won&apos;t reach the studio until wiring is fixed.
        </div>
      )}

      {/* Zip success */}
      {result && !result.pr_url && !error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--ok, #22c55e) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--ok, #22c55e) 30%, transparent)",
            fontSize: 13,
          }}
        >
          Files downloaded successfully.
        </div>
      )}

      {/* Private-repo advisory (Edge 16) */}
      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          padding: "10px 12px",
          borderRadius: 7,
          border: "1px dashed var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        Self-hosted runners execute untrusted PR code, so this workflow targets{" "}
        <strong>private repositories</strong> — the fork guard still skips fork PRs, but
        installing into a public repo is not advised.
      </div>

      {/* Self-hosted runner registration note (Edge 15) */}
      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          padding: "10px 12px",
          borderRadius: 7,
          border: "1px dashed var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        A self-hosted runner matching the configured label must be registered with the
        target repo before jobs will run — otherwise they stay queued and never execute.
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={onInstallPr}
          disabled={isPending || !repo}
          aria-busy={isPending}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            cursor: isPending || !repo ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: 14,
            opacity: isPending || !repo ? 0.65 : 1,
          }}
        >
          {isPending ? "Installing…" : "Open PR"}
        </button>
        <button
          onClick={onInstallZip}
          disabled={isPending || !repo}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            background: "transparent",
            color: "var(--text-primary)",
            border: "1.5px solid var(--border-strong)",
            cursor: isPending || !repo ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: 14,
            opacity: isPending || !repo ? 0.65 : 1,
          }}
        >
          Download ZIP
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard component
// ---------------------------------------------------------------------------

export function CiExportWizard({ agentId, agentName, onClose }: CiExportWizardProps) {
  const [step, setStep] = React.useState(0);

  // Configure state
  const [repo, setRepo] = React.useState("");
  const [triggers, setTriggers] = React.useState<string[]>(["opened", "synchronize"]);
  const [postAs, setPostAs] = React.useState<string>("github_review");
  const [workflowYaml, setWorkflowYaml] = React.useState("");
  const [runnerLabel, setRunnerLabel] = React.useState(DEFAULT_RUNNER_LABEL_INPUT);
  const [studioUrl, setStudioUrl] = React.useState(DEFAULT_STUDIO_URL_INPUT);

  // Preview state
  const [previewFiles, setPreviewFiles] = React.useState<CiFile[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);

  // Install result state
  const [installResult, setInstallResult] = React.useState<CiExportResult | null>(null);
  const [installError, setInstallError] = React.useState<string | null>(null);
  const [installErrorCode, setInstallErrorCode] = React.useState<string | null>(null);

  const exportMutation = useExportCi(agentId);

  // Shared request body — carries the runner label + studio URL collected on
  // Configure into every export call (AC-E4b, AC-U9, AC-E6).
  function buildExportBody(
    action: "open_pr" | "files",
    includeOverride: boolean,
  ): CiExportInputBody & { runner_label: string[]; studio_url: string } {
    return {
      repo,
      action,
      post_as: postAs as "github_review" | "pr_comment" | "none",
      triggers,
      base: "main",
      runner_label: parseRunnerLabel(runnerLabel),
      studio_url: studioUrl,
      ...(includeOverride && workflowYaml ? { workflow_override: workflowYaml } : {}),
    };
  }

  function captureError(err: unknown) {
    setInstallErrorCode(err instanceof ApiError ? (err.code ?? null) : null);
    setInstallError(err instanceof Error ? err.message : String(err));
  }

  // Load preview: call export with action:'files' and render returned files (AC-E2)
  function handleLoadPreview() {
    if (!repo) return;
    setIsLoadingPreview(true);
    setInstallError(null);
    setInstallErrorCode(null);
    exportMutation.mutate(buildExportBody("files", false), {
      onSuccess: (data) => {
        setPreviewFiles(data.files);
        // Extract the editable workflow YAML for the textarea (AC-E3)
        const yaml = extractWorkflowYaml(data.files);
        setWorkflowYaml(yaml);
        setIsLoadingPreview(false);
      },
      onError: (err) => {
        captureError(err);
        setIsLoadingPreview(false);
      },
    });
  }

  // Install: open PR (AC-E4)
  function handleInstallPr() {
    setInstallError(null);
    setInstallErrorCode(null);
    setInstallResult(null);
    exportMutation.mutate(buildExportBody("open_pr", true), {
      onSuccess: (data) => {
        setInstallResult(data);
      },
      onError: (err) => {
        captureError(err);
      },
    });
  }

  // Install: zip download (AC-E5)
  function handleInstallZip() {
    setInstallError(null);
    setInstallErrorCode(null);
    setInstallResult(null);
    exportMutation.mutate(buildExportBody("files", true), {
      onSuccess: (data) => {
        setInstallResult(data);
        const blob = buildZip(data.files);
        triggerDownload(blob, "devdigest-ci.zip");
      },
      onError: (err) => {
        captureError(err);
      },
    });
  }

  const isPending = exportMutation.isPending;

  const footer = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <button
        onClick={() => setStep((s) => Math.max(0, s - 1))}
        disabled={step === 0}
        style={{
          padding: "8px 18px",
          borderRadius: 7,
          border: "1.5px solid var(--border-strong)",
          background: "transparent",
          color: "var(--text-primary)",
          fontSize: 13,
          fontWeight: 600,
          cursor: step === 0 ? "not-allowed" : "pointer",
          opacity: step === 0 ? 0.4 : 1,
        }}
      >
        Back
      </button>

      {step < WIZARD_LABELS.length - 1 ? (
        <button
          onClick={() => setStep((s) => s + 1)}
          disabled={isPending}
          style={{
            padding: "8px 18px",
            borderRadius: 7,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: isPending ? "not-allowed" : "pointer",
            opacity: isPending ? 0.65 : 1,
          }}
        >
          {isPending ? "Loading…" : "Continue"}
        </button>
      ) : null}
    </div>
  );

  return (
    <Modal
      width={760}
      title={`Export to CI${agentName ? ` — ${agentName}` : ""}`}
      subtitle="Bundle your review agent into a GitHub Actions workflow."
      onClose={onClose}
      footer={footer}
    >
      {/* Step indicator */}
      <div style={{ padding: "16px 24px 0", borderBottom: "1px solid var(--border)" }}>
        <ExportWizardSteps step={step} labels={[...WIZARD_LABELS]} />
      </div>

      {/* Step content */}
      {step === 0 && <StepTarget onNext={() => setStep(1)} />}
      {step === 1 && (
        <StepPreview
          agentId={agentId}
          repo={repo}
          triggers={triggers}
          postAs={postAs}
          workflowYaml={workflowYaml}
          onWorkflowYamlChange={setWorkflowYaml}
          previewFiles={previewFiles}
          isLoadingPreview={isLoadingPreview}
          onLoadPreview={handleLoadPreview}
        />
      )}
      {step === 2 && (
        <StepConfigure
          repo={repo}
          onRepoChange={setRepo}
          triggers={triggers}
          onTriggersChange={setTriggers}
          postAs={postAs}
          onPostAsChange={setPostAs}
          runnerLabel={runnerLabel}
          onRunnerLabelChange={setRunnerLabel}
          studioUrl={studioUrl}
          onStudioUrlChange={setStudioUrl}
        />
      )}
      {step === 3 && (
        <StepInstall
          repo={repo}
          isPending={isPending}
          error={installError}
          errorCode={installErrorCode}
          result={installResult}
          onInstallPr={handleInstallPr}
          onInstallZip={handleInstallZip}
        />
      )}
    </Modal>
  );
}
