/* hooks/onboarding.ts — React Query hooks for onboarding tour generation. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { OnboardingResponse, OnboardingGeneratingResponse } from "@devdigest/shared";

export type OnboardingData = OnboardingResponse | OnboardingGeneratingResponse | null;

/**
 * Fetch the current onboarding tour for a repo.
 * Returns null when no tour exists (404 is the expected empty state).
 * Returns { status: 'generating' } when generation is in-progress.
 *
 * Polls every 3s while the server reports { status: 'generating' } — handles the
 * case where the POST request died mid-flight (504/network) but the server lock is
 * still held and will eventually clear.
 */
export function useOnboarding(repoId: string | null | undefined) {
  return useQuery<OnboardingData>({
    queryKey: ["onboarding", repoId],
    queryFn: async () => {
      try {
        return await api.get<OnboardingResponse | OnboardingGeneratingResponse>(
          `/repos/${repoId}/onboarding`,
        );
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!repoId,
    retry: false,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d != null && "status" in d && d.status === "generating" ? 3_000 : false;
    },
  });
}

/**
 * Trigger onboarding tour generation (or regeneration) for a repo.
 * On success, invalidates the onboarding query to trigger a re-fetch.
 * On error, shows a toast — the GET hook's polling will pick up the result once
 * the server lock clears.
 */
export function useGenerateOnboarding() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ repoId, language }: { repoId: string; language?: string }) =>
      api.post<OnboardingResponse>(
        `/repos/${repoId}/onboarding`,
        language ? { language } : undefined,
      ),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["onboarding", repoId] });
    },
    onError: (err, { repoId }) => {
      const msg =
        err instanceof ApiError && err.status === 409
          ? "Generation is already running — it will appear here when ready."
          : "Generation failed. Please try again.";
      toast.error(msg);
      // Trigger a poll cycle so the UI reflects the current server state.
      qc.invalidateQueries({ queryKey: ["onboarding", repoId] });
    },
  });
}
