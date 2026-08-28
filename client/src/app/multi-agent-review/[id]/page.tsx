/* /multi-agent-review/[id] — Results page for a completed or in-progress multi-agent run.
   Thin page entry point: mounts AppShell with breadcrumbs and delegates to ResultsView. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { AppShell } from "../../../components/app-shell";
import { ResultsView } from "./_components/ResultsView";

export default function MultiAgentResultsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  return (
    <AppShell
      crumb={[
        { label: "Multi-Agent Review", href: "/multi-agent-review/configure" },
        { label: `Run #${id.slice(0, 8)}…` },
      ]}
    >
      <ResultsView multiAgentRunId={id} />
    </AppShell>
  );
}
