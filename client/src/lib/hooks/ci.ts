/* hooks/ci.ts — React Query hooks for the Export-to-CI feature. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CiRun,
  CiExport,
  CiExportInputBody,
  CiInstallationView,
  AgentPerformance,
  PerfWindow,
} from "@devdigest/shared";

// ---------------------------------------------------------------------------
// CiExportResult — the actual shape returned by POST /agents/:id/export-ci.
// The route has no response schema, so `ingest_wiring` isn't part of the
// `@devdigest/shared` `CiExport` contract; it's appended server-side
// (server/src/modules/ci/service.ts CiExportResult). Typed locally here.
// ---------------------------------------------------------------------------
export interface IngestWiring {
  status: "ok" | "skipped" | "incomplete";
  error?: string;
}
export interface CiExportResult extends CiExport {
  ingest_wiring: IngestWiring;
}

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
// useCiInstallations — installations for one agent (AC-E8, AC-E3/AC-ST3)
// Server now returns CiInstallationView (adds agent_version, last_status,
// last_run_at) for every row.
// ---------------------------------------------------------------------------
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () =>
      api.get<CiInstallationView[]>(`/ci/installations?agent_id=${agentId}`),
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
      api.post<CiExportResult>(`/agents/${agentId}/export-ci`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}

// ---------------------------------------------------------------------------
// useAgentPerformance — GET /ci/performance?window= (Agent Performance dash)
// ---------------------------------------------------------------------------
export function useAgentPerformance(window: PerfWindow = "30") {
  return useQuery({
    queryKey: ["ci-performance", window],
    queryFn: () => api.get<AgentPerformance>(`/ci/performance?window=${window}`),
  });
}

// ---------------------------------------------------------------------------
// useRemoveInstallation — mutation: DELETE /ci/installations/:id
// No request body (DELETE) — server returns 204, handled by apiFetch as
// `undefined`. Invalidates the installations query on success.
// ---------------------------------------------------------------------------
export function useRemoveInstallation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/ci/installations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-installations"] });
    },
  });
}
