/* hooks/evals.ts — React Query hooks for the Eval Pipeline feature. */
"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { notify } from "../toast";
import type {
  EvalCaseRecord,
  EvalBatchRecord,
  EvalBatchRunRecord,
  EvalBatchComparison,
  EvalAgentSummary,
  EvalWorkspaceDashboard,
  CreateEvalCaseInput,
  UpdateEvalCaseInput,
  TimeRangeFilter,
} from "@devdigest/shared";

// ===========================================================================
// Eval Cases
// ===========================================================================

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCaseRecord[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useEvalCase(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case", caseId],
    queryFn: () => api.get<EvalCaseRecord>(`/eval-cases/${caseId}`),
    enabled: !!caseId,
  });
}

export function useCreateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEvalCaseInput) =>
      api.post<EvalCaseRecord>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
    },
  });
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateEvalCaseInput }) =>
      api.put<EvalCaseRecord>(`/eval-cases/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      qc.setQueryData(["eval-case", data.id], data);
    },
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      qc.removeQueries({ queryKey: ["eval-case", id] });
    },
  });
}

// ===========================================================================
// Eval Runs
// ===========================================================================

export function useRunEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) =>
      api.post<EvalBatchRunRecord>(`/eval-cases/${caseId}/run`),
    onSuccess: () => {
      // Invalidate eval batches so any standalone run shows updated status
      qc.invalidateQueries({ queryKey: ["eval-batches"] });
    },
  });
}

// ===========================================================================
// Eval Batches
// ===========================================================================

export function useStartEvalBatch(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ batch_id: string }>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-batches", agentId] });
    },
  });
}

export function useEvalBatches(
  agentId: string | null | undefined,
  range: TimeRangeFilter = "30d",
) {
  return useQuery({
    queryKey: ["eval-batches", agentId, range],
    queryFn: () =>
      api.get<EvalBatchRecord[]>(`/agents/${agentId}/eval-batches?range=${range}`),
    enabled: !!agentId,
  });
}

export function useEvalBatch(batchId: string | null | undefined) {
  const qc = useQueryClient();
  const { data, ...rest } = useQuery({
    queryKey: ["eval-batch", batchId],
    queryFn: () =>
      api.get<EvalBatchRecord & { runs: EvalBatchRunRecord[] }>(`/eval-batches/${batchId}`),
    enabled: !!batchId,
    // Poll when batch is still active
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 4000 : false;
    },
  });

  // Toast on completion (AC-E8)
  const prevStatus = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    const status = data?.status;
    if (!status) return;
    if (prevStatus.current === status) return;
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (!prev) return; // don't toast on initial load
    if (status === "done") {
      const passed = data?.runs?.filter((r) => r.pass === true).length ?? 0;
      const total = data?.runs?.length ?? 0;
      notify.success(`Eval batch completed: ${passed}/${total} passed`);
    } else if (status === "failed") {
      notify.error("Eval batch failed");
    }
  }, [data?.status, data?.runs]);

  return { data, ...rest };
}

// ===========================================================================
// Dashboards
// ===========================================================================

export function useEvalDashboard() {
  return useQuery({
    queryKey: ["eval-dashboard"],
    queryFn: () => api.get<EvalWorkspaceDashboard>("/eval-dashboard"),
    refetchInterval: 4000, // AC-S3: poll every 4s
  });
}

export function useAgentEvalDashboard(
  agentId: string | null | undefined,
  range: TimeRangeFilter = "30d",
) {
  return useQuery({
    queryKey: ["agent-eval-dashboard", agentId, range],
    queryFn: () =>
      api.get<{
        owner_kind: string;
        owner_id: string;
        cases_total: number;
        current: {
          recall: number;
          precision: number;
          citation_accuracy: number;
          traces_passed: number;
          traces_total: number;
          cost_usd: number | null;
        };
        delta: { recall: number; precision: number; citation_accuracy: number };
        trend: Array<{
          ran_at: string;
          recall: number;
          precision: number;
          citation_accuracy: number;
          pass_rate: number;
          cost_usd: number | null;
        }>;
        recent_runs: EvalBatchRecord[];
        alert: string | null;
      }>(`/agents/${agentId}/eval-dashboard?range=${range}`),
    enabled: !!agentId,
  });
}

// ===========================================================================
// Compare & Promote
// ===========================================================================

export function useCompareBatches(
  batchIdA: string | null | undefined,
  batchIdB: string | null | undefined,
) {
  return useQuery({
    queryKey: ["eval-compare", batchIdA, batchIdB],
    queryFn: () =>
      api.get<EvalBatchComparison>(`/eval-batches/${batchIdA}/compare/${batchIdB}`),
    enabled: !!batchIdA && !!batchIdB,
  });
}

export function usePromoteAgentVersion(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) =>
      api.post(`/agents/${agentId}/promote`, { version }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["eval-batches", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", agentId] });
      notify.success("Agent version promoted successfully");
    },
  });
}
