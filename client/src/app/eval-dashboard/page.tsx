/* /eval-dashboard — Workspace Eval Dashboard (Step 8 + Step 9).
   When ?agent={id} param is present, shows the per-agent detail view.
   Otherwise shows the workspace-wide overview. */
"use client";

import React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { EvalDashboardView } from "./_components/EvalDashboardView";
import { AgentEvalDetail } from "./_components/AgentEvalDetail";
import { useEvalDashboard } from "../../lib/hooks/evals";

export default function EvalDashboardPage() {
  const search = useSearchParams();
  const router = useRouter();
  const agentId = search.get("agent");

  const { data, isLoading } = useEvalDashboard();

  // Resolve agent name for the breadcrumb
  const agentName =
    agentId && data?.agents
      ? (data.agents.find((a) => a.agent_id === agentId)?.agent_name ?? "Agent")
      : undefined;

  const crumb = agentId
    ? [
        { label: "Skills Lab" },
        { label: "Eval Dashboard", href: "/eval-dashboard" },
        { label: agentName ?? "Agent" },
      ]
    : [{ label: "Skills Lab" }, { label: "Eval Dashboard" }];

  return (
    <AppShell crumb={crumb}>
      {agentId ? (
        <div style={{ padding: 28, maxWidth: 1100 }}>
          <AgentEvalDetail agentId={agentId} agentName={agentName ?? "Agent"} />
        </div>
      ) : (
        <EvalDashboardView data={data} isLoading={isLoading} />
      )}
    </AppShell>
  );
}
