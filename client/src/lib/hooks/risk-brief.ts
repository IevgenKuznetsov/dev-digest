/* hooks/risk-brief.ts — React Query hooks for risk brief generation. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { RiskBriefResponse, RiskBriefGeneratingResponse } from "@devdigest/shared";

export type RiskBriefData = RiskBriefResponse | RiskBriefGeneratingResponse | null;

/**
 * Fetch the current risk brief for a PR.
 * Returns null when no brief exists (404 is the expected empty state).
 * Returns { status: 'generating' } when generation is in-progress.
 *
 * Polls every 3s while the server reports { status: 'generating' } — handles the
 * case where the POST request died mid-flight but the server lock is still held
 * (EC-10/GAP-2). Once the lock releases, the next poll picks up the completed brief.
 */
export function useRiskBrief(prId: string | null | undefined) {
  return useQuery<RiskBriefData>({
    queryKey: ["risk-brief", prId],
    queryFn: async () => {
      try {
        return await api.get<RiskBriefResponse | RiskBriefGeneratingResponse>(
          `/pulls/${prId}/brief`,
        );
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!prId,
    retry: false,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d != null && "status" in d && d.status === "generating" ? 3_000 : false;
    },
  });
}

/**
 * Trigger risk brief generation (or regeneration) for a PR.
 * On success, invalidates the risk-brief query to trigger a re-fetch.
 * On error, shows a toast — the GET hook's polling will pick up the result once
 * the server lock clears.
 */
export function useGenerateRiskBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () =>
      api.post<RiskBriefResponse>(`/pulls/${prId}/brief`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["risk-brief", prId] });
    },
    onError: (err) => {
      let msg: string;
      if (err instanceof ApiError) {
        if (err.status === 409) {
          msg = "Generation is already running — it will appear here when ready.";
        } else if (err.status === 422) {
          msg = "PR has no files to analyze.";
        } else {
          msg = "Brief generation failed. Please try again.";
        }
      } else {
        msg = "Brief generation failed. Please try again.";
      }
      toast.error(msg);
      // Trigger a poll cycle so the UI reflects the current server state.
      qc.invalidateQueries({ queryKey: ["risk-brief", prId] });
    },
  });
}
