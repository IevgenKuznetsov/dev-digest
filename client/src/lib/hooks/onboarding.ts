/* hooks/onboarding.ts — React Query hooks for onboarding tour generation. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { OnboardingResponse, OnboardingGeneratingResponse } from "@devdigest/shared";

export type OnboardingData = OnboardingResponse | OnboardingGeneratingResponse | null;

/**
 * Fetch the current onboarding tour for a repo.
 * Returns null when no tour exists (404 is the expected empty state).
 * Returns { status: 'generating' } when generation is in-progress.
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
  });
}

/**
 * Trigger onboarding tour generation (or regeneration) for a repo.
 * On success, invalidates the onboarding query to trigger a re-fetch.
 */
export function useGenerateOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, language }: { repoId: string; language?: string }) =>
      api.post<OnboardingResponse>(
        `/repos/${repoId}/onboarding`,
        language ? { language } : undefined,
      ),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["onboarding", repoId] });
    },
  });
}
