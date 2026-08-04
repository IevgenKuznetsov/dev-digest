/* hooks/skills.ts — React Query hooks for Skills CRUD, import, and agent skill binding. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill, SkillType, SkillSource, AgentSkillLink } from "@devdigest/shared";

// ---- Skills CRUD ----

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

// ---- Import ----

export interface ImportPreview {
  name: string;
  description: string;
  body: string;
  type: "custom";
}

export function useImportSkillPreview() {
  return useMutation({
    mutationFn: (input: { body: string; name?: string }) =>
      api.post<ImportPreview>("/skills/import/preview", input),
  });
}

export function useConfirmSkillImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) =>
      api.post<Skill>("/skills/import/confirm", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

// ---- Versions ----

export interface SkillVersion {
  skillId: string;
  version: number;
  body: string;
  createdAt: string;
}

export function useSkillVersions(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", skillId],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${skillId}/versions`),
    enabled: !!skillId,
  });
}

export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, version }: { skillId: string; version: number }) =>
      api.post<Skill>(`/skills/${skillId}/versions/${version}/restore`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

// ---- Eval cases ----

export interface SkillEvalCase {
  id: string;
  name: string;
  notes: string | null;
}

export function useSkillEvalCases(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-eval-cases", skillId],
    queryFn: () => api.get<SkillEvalCase[]>(`/skills/${skillId}/eval-cases`),
    enabled: !!skillId,
  });
}

// ---- Stats ----

export interface SkillStats {
  used_by_agents: Array<{ id: string; name: string }>;
  agents_count: number;
  pull_frequency: number | null;
  accept_rate: number | null;
  findings_total: number;
  findings_by_category: Record<string, number>;
}

export function useSkillStats(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", skillId],
    queryFn: () => api.get<SkillStats>(`/skills/${skillId}/stats`),
    enabled: !!skillId,
  });
}

// ---- Community search ----

export interface CommunitySkill {
  name: string;
  repo: string;
  stars: number;
  lang: string;
  desc: string;
  body: string;
}

export function useCommunitySkills(q: string, lang: string) {
  return useQuery({
    queryKey: ["community-skills", q, lang],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (lang && lang !== "all") params.set("lang", lang);
      return api.get<CommunitySkill[]>(`/skills/community/search?${params}`);
    },
  });
}

// ---- Import from URL ----

export function useImportFromUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; name?: string }) =>
      api.post<Skill>("/skills/import/url", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

// ---- Agent skill binding ----

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
    },
  });
}
