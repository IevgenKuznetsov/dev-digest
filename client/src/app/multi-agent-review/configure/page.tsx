/* /multi-agent-review/configure — Configure and launch a multi-agent review.
   Thin page entry point: mounts AppShell with breadcrumbs and delegates to ConfigureView. */
"use client";

import React from "react";
import { AppShell } from "../../../components/app-shell";
import { ConfigureView } from "./_components/ConfigureView";

export default function MultiAgentConfigurePage() {
  return (
    <AppShell crumb={[{ label: "Multi-Agent Review" }, { label: "Configure" }]}>
      <ConfigureView />
    </AppShell>
  );
}
