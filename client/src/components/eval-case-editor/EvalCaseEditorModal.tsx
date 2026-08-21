/* EvalCaseEditorModal — shared modal for creating/editing eval cases.
   Used by FindingCard "Turn into eval case" and agent Evals tab "New eval case" / "Edit". */
"use client";

import React from "react";
import { Modal, Button, Toggle, TextInput, FormField } from "@devdigest/ui";
import { notify } from "@/lib/toast";
import { useCreateEvalCase, useUpdateEvalCase, useRunEvalCase } from "@/lib/hooks/evals";
import type { EvalCaseRecord, CreateEvalCaseInput, UpdateEvalCaseInput } from "@devdigest/shared";
import { FINDING_SKELETON_TEMPLATE, INPUT_TABS, type InputTab } from "./constants";
import { s } from "./styles";

export interface EvalCaseEditorModalProps {
  /** Agent ID this case belongs to. */
  agentId: string;
  /** If editing an existing case, pass its record. Omit for creation mode. */
  existingCase?: EvalCaseRecord;
  /** Pre-populated data (e.g. from FindingCard "Turn into eval case"). */
  initialData?: Partial<CreateEvalCaseInput>;
  onClose: () => void;
  onSaved?: (record: EvalCaseRecord) => void;
}

export function EvalCaseEditorModal({
  agentId,
  existingCase,
  initialData,
  onClose,
  onSaved,
}: EvalCaseEditorModalProps) {
  const isEditing = !!existingCase;

  // --- form state ---
  const [name, setName] = React.useState(existingCase?.name ?? initialData?.name ?? "");
  const [inputTab, setInputTab] = React.useState<InputTab>("Diff");
  const [diff, setDiff] = React.useState(
    existingCase?.input_diff ?? initialData?.input_diff ?? "",
  );
  const [filesJson, setFilesJson] = React.useState(
    existingCase?.input_files != null
      ? JSON.stringify(existingCase.input_files, null, 2)
      : "",
  );
  const [metaJson, setMetaJson] = React.useState(
    existingCase?.input_meta != null
      ? JSON.stringify(existingCase.input_meta, null, 2)
      : "",
  );
  const [expectedJson, setExpectedJson] = React.useState(
    existingCase?.expected_output != null
      ? JSON.stringify(existingCase.expected_output, null, 2)
      : initialData?.expected_output != null
        ? JSON.stringify(initialData.expected_output, null, 2)
        : "[]",
  );
  const [notes, setNotes] = React.useState(existingCase?.notes ?? "");
  const [runOnSave, setRunOnSave] = React.useState(true);
  const [lastRunResult, setLastRunResult] = React.useState<{
    pass: boolean | null;
    summary: string;
  } | null>(null);

  // --- JSON validation ---
  const jsonValidation = React.useMemo(() => {
    try {
      JSON.parse(expectedJson);
      return { valid: true, error: null };
    } catch (e: unknown) {
      return { valid: false, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  }, [expectedJson]);

  // --- hooks ---
  const createCase = useCreateEvalCase(agentId);
  const updateCase = useUpdateEvalCase();
  const runCase = useRunEvalCase();

  // Focus trap: keep focus inside modal, Escape to close
  const modalRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    // Focus first focusable on open
    const firstFocusable = el.querySelector<HTMLElement>(
      "input, textarea, button, select, [tabindex]:not([tabindex='-1'])",
    );
    firstFocusable?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        el!.querySelectorAll<HTMLElement>(
          "input, textarea, button:not([disabled]), select, [tabindex]:not([tabindex='-1'])",
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

  function insertSkeleton() {
    setExpectedJson(FINDING_SKELETON_TEMPLATE);
  }

  function buildInput(): CreateEvalCaseInput {
    let parsedFiles: unknown = undefined;
    let parsedMeta: unknown = undefined;
    if (filesJson.trim()) {
      try { parsedFiles = JSON.parse(filesJson); } catch { /* ignore */ }
    }
    if (metaJson.trim()) {
      try { parsedMeta = JSON.parse(metaJson); } catch { /* ignore */ }
    }
    return {
      name: name.trim(),
      input_diff: diff,
      input_files: parsedFiles as CreateEvalCaseInput["input_files"],
      input_meta: parsedMeta as CreateEvalCaseInput["input_meta"],
      expected_output: JSON.parse(expectedJson),
      notes: notes.trim() || undefined,
    };
  }

  async function handleSave() {
    if (!jsonValidation.valid) {
      notify.error("Fix JSON errors before saving");
      return;
    }
    if (!name.trim()) {
      notify.error("Name is required");
      return;
    }
    try {
      const input = buildInput();
      let saved: EvalCaseRecord;
      if (isEditing && existingCase) {
        const patch: UpdateEvalCaseInput = input;
        saved = await updateCase.mutateAsync({ id: existingCase.id, patch });
      } else {
        saved = await createCase.mutateAsync(input);
      }
      onSaved?.(saved);
      if (runOnSave) {
        try {
          const run = await runCase.mutateAsync(saved.id);
          const passText = run.pass === true ? "passed" : run.pass === false ? "failed" : "error";
          setLastRunResult({
            pass: run.pass,
            summary: `Last run: ${passText}${run.duration_ms ? ` — ${(run.duration_ms / 1000).toFixed(1)}s` : ""}`,
          });
        } catch {
          notify.error("Eval case saved but run failed");
        }
      }
      notify.success(isEditing ? "Eval case updated" : "Eval case created");
      if (!runOnSave) onClose();
    } catch {
      notify.error("Failed to save eval case");
    }
  }

  async function handleRunNow() {
    if (!existingCase) {
      notify.error("Save the case first to run it");
      return;
    }
    try {
      const run = await runCase.mutateAsync(existingCase.id);
      const passText = run.pass === true ? "passed" : run.pass === false ? "failed" : "error";
      setLastRunResult({
        pass: run.pass,
        summary: `Run: ${passText}${run.duration_ms ? ` — ${(run.duration_ms / 1000).toFixed(1)}s${run.cost_usd != null ? ` — $${run.cost_usd.toFixed(4)}` : ""}` : ""}`,
      });
    } catch {
      notify.error("Run failed");
    }
  }

  const saving = createCase.isPending || updateCase.isPending;
  const running = runCase.isPending;

  const footer = (
    <div style={s.footer}>
      <div style={s.footerLeft}>
        <div style={s.toggleRow}>
          <Toggle on={runOnSave} onChange={setRunOnSave} size={14} />
          <span>Run on save</span>
        </div>
        {lastRunResult && (
          <span style={s.runStatusText} aria-live="polite">
            {lastRunResult.summary}
          </span>
        )}
      </div>
      <Button kind="ghost" size="sm" onClick={onClose} disabled={saving || running}>
        Cancel
      </Button>
      {existingCase && (
        <Button
          kind="secondary"
          size="sm"
          icon="Play"
          loading={running}
          onClick={handleRunNow}
          disabled={saving}
        >
          Run case
        </Button>
      )}
      <Button
        kind="primary"
        size="sm"
        icon="Check"
        loading={saving}
        onClick={handleSave}
        disabled={!jsonValidation.valid || !name.trim() || running}
      >
        Save
      </Button>
    </div>
  );

  return (
    <Modal
      width={760}
      title={isEditing ? `Eval case — ${existingCase.name}` : "New eval case"}
      onClose={onClose}
      footer={footer}
    >
      <div ref={modalRef} style={s.body}>
        {/* Name */}
        <div style={s.fieldRow}>
          <FormField label="Name" required>
            <TextInput
              value={name}
              onChange={setName}
              placeholder="e.g. Must detect hardcoded secret"
            />
          </FormField>
        </div>

        {/* Input section */}
        <div style={s.fieldRow}>
          <div style={s.fieldLabel}>Input</div>
          <div style={s.inputTabBar} role="tablist" aria-label="Input type">
            {INPUT_TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={inputTab === t}
                style={s.inputTab(inputTab === t)}
                onClick={() => setInputTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {inputTab === "Diff" && (
            <textarea
              style={s.monoArea}
              value={diff}
              onChange={(e) => setDiff(e.target.value)}
              placeholder="Paste unified diff text here…"
              rows={8}
              aria-label="Diff input"
            />
          )}
          {inputTab === "Files" && (
            <textarea
              style={s.monoArea}
              value={filesJson}
              onChange={(e) => setFilesJson(e.target.value)}
              placeholder='{"path": "src/file.ts", "content": "..."}'
              rows={6}
              aria-label="Files JSON input"
            />
          )}
          {inputTab === "PR meta" && (
            <textarea
              style={s.monoArea}
              value={metaJson}
              onChange={(e) => setMetaJson(e.target.value)}
              placeholder='{"title": "PR title", "description": "..."}'
              rows={6}
              aria-label="PR meta JSON input"
            />
          )}
        </div>

        {/* Expected output */}
        <div style={s.fieldRow}>
          <div style={s.fieldLabel}>Expected output</div>
          <textarea
            style={s.monoArea}
            value={expectedJson}
            onChange={(e) => setExpectedJson(e.target.value)}
            rows={6}
            aria-label="Expected output JSON"
            aria-describedby="json-status"
          />
          <div style={s.jsonStatusRow}>
            <span id="json-status" style={s.jsonStatus(jsonValidation.valid)}>
              {jsonValidation.valid ? "Valid JSON" : `Invalid JSON: ${jsonValidation.error}`}
            </span>
            <Button kind="ghost" size="sm" onClick={insertSkeleton}>
              Finding skeleton
            </Button>
          </div>
        </div>

        {/* Notes */}
        <div style={s.fieldRow}>
          <FormField label="Notes (optional)">
            <textarea
              style={{ ...s.monoArea, fontFamily: "inherit", fontSize: 13 }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Optional notes about this eval case…"
              aria-label="Notes"
            />
          </FormField>
        </div>
      </div>
    </Modal>
  );
}
