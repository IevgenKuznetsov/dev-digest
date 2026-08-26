/* hooks/ci.ts — React Query hooks for the Export-to-CI feature. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CiRun,
  CiInstallation,
  CiExport,
  CiExportInputBody,
} from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Poll interval for CI run auto-refresh (AC-ST3). Spec window: 15–30 s.
// ---------------------------------------------------------------------------
export const CI_RUNS_POLL_MS = 20_000;

// ---------------------------------------------------------------------------
// Filters for GET /ci/runs
// ---------------------------------------------------------------------------
export interface CiRunsFilters {
  repo?: string | null;
  agent?: string | null;
  source?: string | null;
  status?: string | null;
}

function buildRunsQuery(filters: CiRunsFilters): string {
  const params = new URLSearchParams();
  if (filters.repo) params.set("repo", filters.repo);
  if (filters.agent) params.set("agent", filters.agent);
  if (filters.source) params.set("source", filters.source);
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  return qs ? `/ci/runs?${qs}` : "/ci/runs";
}

// ---------------------------------------------------------------------------
// useCiRuns — workspace CI run list with auto-refresh (AC-ST3)
// ---------------------------------------------------------------------------
export function useCiRuns(filters: CiRunsFilters = {}) {
  return useQuery({
    queryKey: ["ci-runs", filters],
    queryFn: () => api.get<CiRun[]>(buildRunsQuery(filters)),
    refetchInterval: CI_RUNS_POLL_MS,
  });
}

// ---------------------------------------------------------------------------
// useCiInstallations — installations for one agent (AC-E8)
// ---------------------------------------------------------------------------
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () =>
      api.get<CiInstallation[]>(`/ci/installations?agent_id=${agentId}`),
    enabled: !!agentId,
  });
}

// ---------------------------------------------------------------------------
// useExportCi — mutation: POST /agents/:id/export-ci (AC-E4, AC-E5)
// On success: invalidate installations + runs cache.
// ---------------------------------------------------------------------------
export function useExportCi(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CiExportInputBody) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}
