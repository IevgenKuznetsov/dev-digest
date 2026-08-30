/* /agent-performance — Agent Performance dashboard (AC-E1). Thin orchestrator:
   resolves the ?window= param, delegates rendering to AgentPerformanceView. */
"use client";

import React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { AgentPerformanceView } from "../../components/AgentPerformance";
import { useAgentPerformance } from "../../lib/hooks/ci";
import { DEFAULT_WINDOW } from "../../components/AgentPerformance/constants";
import type { PerfWindow } from "@devdigest/shared";

const VALID_WINDOWS: PerfWindow[] = ["7", "30", "90"];

export default function AgentPerformancePage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const raw = searchParams.get("window");
  const window: PerfWindow = VALID_WINDOWS.includes(raw as PerfWindow)
    ? (raw as PerfWindow)
    : DEFAULT_WINDOW;

  const { data, isLoading } = useAgentPerformance(window);

  function handleWindowChange(next: PerfWindow) {
    router.push(`/agent-performance?window=${next}`);
  }

  const crumb = [{ label: "Agent Performance" }];

  return (
    <AppShell crumb={crumb}>
      <AgentPerformanceView
        data={data}
        isLoading={isLoading}
        window={window}
        onWindowChange={handleWindowChange}
      />
    </AppShell>
  );
}
