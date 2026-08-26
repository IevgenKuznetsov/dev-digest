/* hooks/multi-agent-review.ts — React Query hooks for the Multi-Agent Review feature.
   Covers: create a run, fetch run detail (with polling), and pre-run estimates. */
"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../api";
import type {
  MultiAgentRunDetail,
  MultiAgentRunRequest,
  MultiAgentRunResponse,
  MultiAgentEstimate,
} from "@devdigest/shared";

// ---- GET /multi-agent-run/:id ----

/**
 * Fetch a multi-agent run by ID (workspace-scoped — no prId in path).
 * Polls every 4 seconds while any column still has status 'running'.
 */
export function useMultiAgentRun(multiAgentRunId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", multiAgentRunId],
    queryFn: () => api.get<MultiAgentRunDetail>(`/multi-agent-run/${multiAgentRunId}`),
    enabled: !!multiAgentRunId,
    refetchInterval: (query) => {
      const columns = query.state.data?.columns ?? [];
      const anyRunning = columns.some((c) => c.status === "running");
      return anyRunning ? 4_000 : false;
    },
  });
}

// ---- POST /pulls/:prId/multi-agent-run ----

export interface CreateMultiAgentRunInput {
  prId: string;
  agent_ids: string[];
}

/**
 * Trigger a new multi-agent review run against a PR.
 * Returns the new multi-agent run ID and run stubs for SSE subscription.
 */
export function useCreateMultiAgentRun() {
  return useMutation({
    mutationFn: ({ prId, agent_ids }: CreateMultiAgentRunInput) => {
      const body: MultiAgentRunRequest = { agent_ids };
      return api.post<MultiAgentRunResponse>(`/pulls/${prId}/multi-agent-run`, body);
    },
  });
}

// ---- GET /agents/estimates ----

/**
 * Fetch pre-run cost/duration estimates for all agents in the workspace,
 * derived from each agent's most recent completed run.
 * staleTime: 60s — estimates change slowly (only when runs complete).
 */
export function useAgentEstimates() {
  return useQuery({
    queryKey: ["agent-estimates"],
    queryFn: () => api.get<MultiAgentEstimate>("/agents/estimates"),
    staleTime: 60_000,
  });
}
