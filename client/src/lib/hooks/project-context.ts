/* hooks/project-context.ts — TanStack Query hooks for the Project Context feature. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiText, apiUpload } from "../api";

// ---------------------------------------------------------------------------
// Types (inline — matching the server API shapes)
// ---------------------------------------------------------------------------

export interface ContextDoc {
  id: string;
  repoId: string;
  workspaceId: string;
  path: string;
  category: "specs" | "docs" | "insights" | "other";
  tokens: number;
  scannedAt: string;
  createdAt: string;
}

export interface AgentContextDoc extends ContextDoc {
  order: number;
}

export interface AgentContextResponse {
  attached: AgentContextDoc[];
  totalAvailable: number;
}

export interface SkillContextDoc extends ContextDoc {
  order: number;
}

export interface SetContextEntry {
  contextDocId: string;
  order: number;
}

// ---------------------------------------------------------------------------
// Context document discovery & management
// ---------------------------------------------------------------------------

export function useContextDocs(repoId: string | null | undefined, search?: string) {
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  return useQuery({
    queryKey: ["context-docs", repoId, search],
    queryFn: () => api.get<ContextDoc[]>(`/repos/${repoId}/context/docs${params}`),
    enabled: !!repoId,
  });
}

export function useContextDoc(repoId: string | null | undefined, docId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-doc", repoId, docId],
    queryFn: () => api.get<ContextDoc>(`/repos/${repoId}/context/docs/${docId}`),
    enabled: !!repoId && !!docId,
  });
}

export function useContextDocContent(repoId: string | null | undefined, docId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-doc-content", repoId, docId],
    queryFn: () => apiText(`/repos/${repoId}/context/docs/${docId}/content`),
    enabled: !!repoId && !!docId,
  });
}

export function useScanContextDocs(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ jobId: string }>(`/repos/${repoId}/context/scan`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
    },
  });
}

export function useUpdateContextDocContent(
  repoId: string | null | undefined,
  docId: string | null | undefined,
  options?: { onSuccess?: () => void },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      api.put<ContextDoc>(`/repos/${repoId}/context/docs/${docId}/content`, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["context-doc", repoId, docId] });
      qc.invalidateQueries({ queryKey: ["context-doc-content", repoId, docId] });
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
      options?.onSuccess?.();
    },
  });
}

export function useCreateContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { directory: "specs" | "docs" | "insights"; filename: string; content?: string }) =>
      api.post<ContextDoc>(`/repos/${repoId}/context/docs`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
    },
  });
}

export function useDeleteContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.del<{ ok: boolean }>(`/repos/${repoId}/context/docs/${docId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
    },
  });
}

export function useUploadContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) =>
      apiUpload<ContextDoc>(`/repos/${repoId}/context/docs/upload`, formData),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
    },
  });
}

export function useCreateContextFolder(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { directory: "specs" | "docs" | "insights"; name: string }) =>
      api.post<{ ok: boolean }>(`/repos/${repoId}/context/folders`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Agent context attachments
// ---------------------------------------------------------------------------

export function useAgentContext(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context", agentId],
    queryFn: () => api.get<AgentContextResponse>(`/agents/${agentId}/context`),
    enabled: !!agentId,
  });
}

export function useSetAgentContext(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docs: SetContextEntry[]) =>
      api.put<{ ok: boolean }>(`/agents/${agentId}/context`, { docs }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-context", agentId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Skill context attachments
// ---------------------------------------------------------------------------

export interface SkillContextResponse {
  attached: SkillContextDoc[];
  totalAvailable: number;
}

export function useSkillContext(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context", skillId],
    queryFn: () => api.get<SkillContextResponse>(`/skills/${skillId}/context`),
    enabled: !!skillId,
  });
}

export function useSetSkillContext(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docs: SetContextEntry[]) =>
      api.put<{ ok: boolean }>(`/skills/${skillId}/context`, { docs }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-context", skillId] });
    },
  });
}
