/* CompareModal — side-by-side comparison of two eval batch runs.
   Focus-trapped, Escape to close. */
"use client";

import React from "react";
import { Modal, Button, Icon, Skeleton } from "@devdigest/ui";
import { notify } from "@/lib/toast";
import { useCompareBatches, usePromoteAgentVersion } from "@/lib/hooks/evals";
import type { MetricDelta } from "@devdigest/shared";
import { s } from "./styles";

function computeLineDiff(a: string, b: string): Array<{ kind: "add" | "remove" | "context"; line: string }> {
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const result: Array<{ kind: "add" | "remove" | "context"; line: string }> = [];
  const maxLen = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < maxLen; i++) {
    const la = linesA[i];
    const lb = linesB[i];
    if (la === lb) {
      result.push({ kind: "context", line: la ?? "" });
    } else {
      if (la !== undefined) result.push({ kind: "remove", line: la });
      if (lb !== undefined) result.push({ kind: "add", line: lb });
    }
  }
  return result;
}

function DeltaCard({
  label,
  metric,
  higherIsBetter = true,
}: {
  label: string;
  metric: MetricDelta;
  higherIsBetter?: boolean;
}) {
  const delta = metric.delta;
  const positive =
    delta == null ? null : higherIsBetter ? delta > 0 : delta < 0;
  const sign = delta != null && delta > 0 ? "+" : "";
  return (
    <div style={s.metricDelta}>
      <div style={s.metricDeltaLabel}>{label}</div>
      <div style={s.metricDeltaRow}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {metric.a != null ? (metric.a * 100).toFixed(1) + "%" : "—"}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>→</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          {metric.b != null ? (metric.b * 100).toFixed(1) + "%" : "—"}
        </span>
        {delta != null && (
          <span style={s.deltaValue(positive)}>
            {sign}{(delta * 100).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

export function CompareModal({
  batchIdA,
  batchIdB,
  agentId,
  onClose,
}: {
  batchIdA: string;
  batchIdB: string;
  agentId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useCompareBatches(batchIdA, batchIdB);
  const promote = usePromoteAgentVersion(agentId);
  const [caseFlipsOpen, setCaseFlipsOpen] = React.useState(false);

  // Focus trap + Escape
  const modalRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const el = modalRef.current;
      if (!el) return;
      const focusable = Array.from(
        el.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handlePromote(version: number) {
    promote.mutate(version, {
      onSuccess: () => onClose(),
      onError: () => notify.error("Promote failed"),
    });
  }

  const versionA = data?.batch_a.agent_version;
  const versionB = data?.batch_b.agent_version;

  const footer = (
    <div style={s.footer}>
      <Button kind="ghost" size="sm" onClick={onClose}>
        Close
      </Button>
      {versionA != null && (
        <Button
          kind="secondary"
          size="sm"
          icon="ArrowUp"
          loading={promote.isPending}
          onClick={() => handlePromote(versionA)}
          aria-label={`Promote v${versionA}`}
        >
          Promote v{versionA}
        </Button>
      )}
    </div>
  );

  const title =
    versionA != null && versionB != null
      ? `Compare runs — v${versionA} vs v${versionB}`
      : "Compare runs";

  return (
    <Modal width={820} title={title} onClose={onClose} footer={footer}>
      <div ref={modalRef} style={s.body}>
        {isLoading ? (
          <Skeleton height={300} />
        ) : !data ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Could not load comparison data.
          </p>
        ) : (
          <>
            {/* Metric deltas */}
            <div>
              <div style={s.sectionTitle}>Metric Deltas</div>
              <div style={s.metricsGrid}>
                <DeltaCard label="Recall" metric={data.recall} />
                <DeltaCard label="Precision" metric={data.precision} />
                <DeltaCard label="Citation Accuracy" metric={data.citation_accuracy} />
                <DeltaCard label="Pass Fraction" metric={data.pass_fraction} />
                <DeltaCard label="Cost (USD)" metric={data.cost_usd} higherIsBetter={false} />
              </div>
            </div>

            {/* System prompt diff */}
            {(data.system_prompt_a || data.system_prompt_b) && (
              <div>
                <div style={s.sectionTitle}>System Prompt Diff</div>
                <div style={s.diffContainer} aria-label="System prompt diff">
                  {computeLineDiff(data.system_prompt_a ?? "", data.system_prompt_b ?? "").map((line, i) => (
                    <span
                      key={i}
                      style={
                        line.kind === "add"
                          ? s.diffAdd
                          : line.kind === "remove"
                            ? s.diffRemove
                            : s.diffContext
                      }
                    >
                      {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
                      {line.line}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Case flips */}
            {data.case_flips.length > 0 && (
              <div>
                <button
                  style={s.collapseTrigger}
                  onClick={() => setCaseFlipsOpen((o) => !o)}
                  aria-expanded={caseFlipsOpen}
                  aria-controls="case-flips"
                >
                  <Icon.ChevronRight
                    size={14}
                    style={{
                      transform: caseFlipsOpen ? "rotate(90deg)" : undefined,
                      transition: "transform .15s",
                    }}
                    aria-hidden="true"
                  />
                  Case changes ({data.case_flips.length})
                </button>
                {caseFlipsOpen && (
                  <div id="case-flips" style={{ marginTop: 10 }}>
                    {data.case_flips.map((flip) => (
                      <div key={flip.case_id} style={s.flipRow(flip.regression)}>
                        <span style={s.flipIcon(flip.regression)}>
                          {flip.regression ? (
                            <><Icon.XCircle size={14} aria-hidden="true" /><span className="sr-only">Regression</span></>
                          ) : (
                            <><Icon.CheckCircle size={14} aria-hidden="true" /><span className="sr-only">Fixed</span></>
                          )}
                        </span>
                        <span style={{ flex: 1, fontSize: 13 }}>
                          {flip.case_name ?? flip.case_id}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {flip.regression ? "was passing → now failing" : "was failing → now passing"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
