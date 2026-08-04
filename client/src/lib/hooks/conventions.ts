/* hooks/conventions.ts — React Query hooks for Conventions extraction and management. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate, Skill } from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (_data, repoId) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accepted }: { id: string; accepted: boolean }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, { accepted }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions"] });
    },
  });
}

export function useBatchUpdateConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, accepted }: { ids: string[]; accepted: boolean }) =>
      api.patch<{ updated: number }>("/conventions/batch", { ids, accepted }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions"] });
    },
  });
}

export function useDeleteConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.del<void>(`/repos/${repoId}/conventions`),
    onSuccess: (_data, repoId) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export function useCreateConventionSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      repoId,
      name,
      description,
    }: {
      repoId: string;
      name: string;
      description: string;
    }) => api.post<Skill>(`/repos/${repoId}/conventions/skill`, { name, description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
