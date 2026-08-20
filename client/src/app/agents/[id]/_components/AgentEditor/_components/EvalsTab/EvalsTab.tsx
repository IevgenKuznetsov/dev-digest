/* EvalsTab — Evals management tab in the agent editor.
   Lists eval cases, allows run/edit/delete, "Run all evals" batch trigger,
   and "New eval case" entry point. */
"use client";

import React from "react";
import Link from "next/link";
import { Icon, Button, Skeleton, EmptyState } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import type { EvalCaseRecord } from "@devdigest/shared";
import { notify } from "@/lib/toast";
import {
  useEvalCases,
  useDeleteEvalCase,
  useRunEvalCase,
  useStartEvalBatch,
  useAgentEvalDashboard,
  useEvalBatches,
  useEvalBatch,
} from "@/lib/hooks/evals";
import { EvalCaseEditorModal } from "@/components/eval-case-editor";
import { s } from "./styles";
import { METRICS_LABELS } from "./constants";

export function EvalsTab({ agent }: { agent: Agent }) {
  const { data: cases, isLoading } = useEvalCases(agent.id);
  const { data: batches } = useEvalBatches(agent.id);
  const { data: dashboard } = useAgentEvalDashboard(agent.id);
  const deleteMutation = useDeleteEvalCase();
  const runCase = useRunEvalCase();
  const startBatch = useStartEvalBatch(agent.id);

  const [modalMode, setModalMode] = React.useState<"create" | "edit" | null>(null);
  const [editingCase, setEditingCase] = React.useState<EvalCaseRecord | null>(null);

  // Track per-case pass/fail from individual runs (overrides batch data)
  const [singleRunResults, setSingleRunResults] = React.useState<Map<string, boolean | null>>(new Map());

  // Is any batch currently running/queued for this agent?
  const activeBatch = batches?.find(
    (b) => b.status === "queued" || b.status === "running",
  ) ?? null;
  const batchInProgress = !!activeBatch;

  // Fetch the latest completed batch to get per-case pass/fail
  const latestDoneBatch = batches?.find((b) => b.status === "done") ?? null;
  const { data: latestBatchDetail } = useEvalBatch(latestDoneBatch?.id ?? null);

  // Fetch active batch detail for progress tracking (polls while running)
  const { data: activeBatchDetail } = useEvalBatch(activeBatch?.id ?? null);

  // Build case_id → pass map from latest completed batch + single-run overrides
  const casePassMap = React.useMemo(() => {
    const m = new Map<string, boolean | null>();
    if (latestBatchDetail?.runs) {
      for (const run of latestBatchDetail.runs) {
        m.set(run.case_id, run.pass);
      }
    }
    // Single-run results override batch results
    for (const [caseId, pass] of singleRunResults) {
      m.set(caseId, pass);
    }
    return m;
  }, [latestBatchDetail?.runs, singleRunResults]);

  // Batch progress: count completed runs vs total cases
  const batchProgress = React.useMemo(() => {
    if (!activeBatchDetail?.runs || !cases) return null;
    const completed = activeBatchDetail.runs.length;
    const total = cases.length;
    // Find the currently running case (last in runs list, or the next not yet started)
    const finishedCaseIds = new Set(activeBatchDetail.runs.map((r) => r.case_id));
    const currentCase = cases.find((c) => !finishedCaseIds.has(c.id));
    return { completed, total, currentCaseName: currentCase?.name ?? null };
  }, [activeBatchDetail?.runs, cases]);

  function openCreate() {
    setEditingCase(null);
    setModalMode("create");
  }

  function openEdit(evalCase: EvalCaseRecord) {
    setEditingCase(evalCase);
    setModalMode("edit");
  }

  function closeModal() {
    setModalMode(null);
    setEditingCase(null);
  }

  async function handleDelete(id: string, name: string) {
    const ok = window.confirm(`Delete eval case "${name}"? This will also delete all run history.`);
    if (!ok) return;
    deleteMutation.mutate(id, {
      onError: () => notify.error("Failed to delete eval case"),
    });
  }

  async function handleRunCase(id: string) {
    runCase.mutate(id, {
      onSuccess: (run) => {
        const status = run.pass === true ? "passed" : run.pass === false ? "failed" : "error";
        if (run.pass === true) notify.success(`Run ${status}`);
        else notify.error(`Run ${status}`);
        setSingleRunResults((prev) => new Map(prev).set(id, run.pass));
      },
      onError: () => notify.error("Run failed"),
    });
  }

  async function handleRunAll() {
    if ((cases?.length ?? 0) === 0) {
      notify.error("No eval cases to run");
      return;
    }
    startBatch.mutate(undefined, {
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("409") || msg.toLowerCase().includes("conflict")) {
          notify.error("A batch is already running for this agent");
        } else if (msg.includes("400")) {
          notify.error("No eval cases to run");
        } else {
          notify.error("Failed to start eval batch");
        }
      },
    });
  }

  function formatPercent(v: number | null | undefined): string {
    if (v == null) return "—";
    return (v * 100).toFixed(1) + "%";
  }

  const current = dashboard?.current;

  return (
    <div style={s.wrap}>
      {/* Metrics summary */}
      <div>
        <div style={s.headerRow}>
          <h2 style={s.h2}>Eval Metrics</h2>
          <Link href={`/eval-dashboard?agent=${agent.id}`} style={s.dashboardLink}>
            View full dashboard →
          </Link>
        </div>
        <div style={s.metricsRow}>
          {(["recall", "precision", "citation_accuracy"] as const).map((key) => (
            <div key={key} style={s.metricCard} aria-label={`${METRICS_LABELS[key]}: ${formatPercent(current?.[key])}`}>
              <div style={s.metricLabel}>{METRICS_LABELS[key]}</div>
              <div style={s.metricValue}>{formatPercent(current?.[key])}</div>
            </div>
          ))}
          <div style={s.metricCard} aria-label={`Pass rate: ${current ? `${current.traces_passed}/${current.traces_total}` : "—"}`}>
            <div style={s.metricLabel}>Pass rate</div>
            <div style={s.metricValue}>
              {current ? `${current.traces_passed}/${current.traces_total}` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Eval cases list header */}
      <div style={s.headerRow}>
        <h2 style={s.h2}>Eval Cases</h2>
        <Button
          kind="secondary"
          size="sm"
          icon="Play"
          loading={startBatch.isPending || batchInProgress}
          disabled={batchInProgress || startBatch.isPending || (cases?.length ?? 0) === 0}
          onClick={handleRunAll}
          aria-label={batchInProgress ? "Batch running — disabled" : "Run all evals"}
        >
          {batchInProgress ? "Running…" : "Run all evals"}
        </Button>
        <Button kind="primary" size="sm" icon="Plus" onClick={openCreate}>
          New eval case
        </Button>
      </div>

      {/* Batch progress indicator */}
      {batchInProgress && batchProgress && (
        <div style={s.batchProgress}>
          <Icon.RefreshCw size={14} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.batchProgressText}>
            Running eval {batchProgress.completed + 1}/{batchProgress.total}
            {batchProgress.currentCaseName && (
              <> — <strong>{batchProgress.currentCaseName}</strong></>
            )}
          </span>
          <span style={s.batchProgressCount}>
            {batchProgress.completed} of {batchProgress.total} finished
          </span>
        </div>
      )}

      {/* Cases list */}
      {isLoading ? (
        <Skeleton height={160} />
      ) : !cases || cases.length === 0 ? (
        <EmptyState
          icon="FlaskConical"
          title="No eval cases yet"
          body='Click "New eval case" to create your first, or use "Turn into eval case" on an accepted/dismissed finding.'
        />
      ) : (
        <div>
          {cases.map((c) => {
            const expectedItems = Array.isArray(c.expected_output)
              ? (c.expected_output as Array<{ type: string }>)
              : [];
            const mustFind = expectedItems.filter((e) => e.type === "must_find").length;
            const mustNotFlag = expectedItems.filter((e) => e.type === "must_not_flag").length;
            const passIndicator = casePassMap.get(c.id) ?? null;
            return (
              <div key={c.id} style={s.caseRow(passIndicator)}>
                <span style={s.caseName}>{c.name}</span>

                {/* Expected output summary */}
                <span style={s.badge}>
                  {mustFind > 0 && `${mustFind} must_find`}
                  {mustFind > 0 && mustNotFlag > 0 && ", "}
                  {mustNotFlag > 0 && `${mustNotFlag} must_not_flag`}
                  {mustFind === 0 && mustNotFlag === 0 && "no expectations"}
                </span>


                {/* Pass/fail indicator — icon + text (not color alone) */}
                <span style={s.passIndicator(passIndicator)} aria-label="Last run status">
                  {passIndicator === true && (
                    <><Icon.CheckCircle size={13} aria-hidden="true" /><span>Pass</span></>
                  )}
                  {passIndicator === false && (
                    <><Icon.XCircle size={13} aria-hidden="true" /><span>Fail</span></>
                  )}
                  {passIndicator === null && (
                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>no runs</span>
                  )}
                </span>

                {/* Actions */}
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Play"
                  loading={runCase.isPending}
                  onClick={() => handleRunCase(c.id)}
                  aria-label={`Run eval case: ${c.name}`}
                />
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Edit"
                  onClick={() => openEdit(c)}
                  aria-label={`Edit eval case: ${c.name}`}
                />
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Trash"
                  onClick={() => handleDelete(c.id, c.name)}
                  aria-label={`Delete eval case: ${c.name}`}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Eval case editor modal */}
      {modalMode && (
        <EvalCaseEditorModal
          agentId={agent.id}
          existingCase={modalMode === "edit" && editingCase ? editingCase : undefined}
          onClose={closeModal}
          onSaved={() => closeModal()}
        />
      )}
    </div>
  );
}
