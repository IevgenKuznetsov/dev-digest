/* /ci-runs — CI Runs navigation page (AC-E7, AC-ST3).
   Thin orchestrator: resolves filters from URL search params,
   delegates rendering to CiRunsTable + FilterBar. */
"use client";

import React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { CiRunsTable } from "./_components/CiRunsTable";
import { FilterBar } from "./_components/FilterBar";
import { useCiRuns } from "../../lib/hooks/ci";
import type { CiRunsFilters } from "../../lib/hooks/ci";

export default function CiRunsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const filters: CiRunsFilters = {
    repo: searchParams.get("repo"),
    agent: searchParams.get("agent"),
    source: searchParams.get("source"),
    status: searchParams.get("status"),
  };

  const { data, isLoading, error } = useCiRuns(filters);

  function handleFiltersChange(next: CiRunsFilters) {
    const params = new URLSearchParams();
    if (next.repo) params.set("repo", next.repo);
    if (next.agent) params.set("agent", next.agent);
    if (next.source) params.set("source", next.source);
    if (next.status) params.set("status", next.status);
    const qs = params.toString();
    router.push(qs ? `/ci-runs?${qs}` : "/ci-runs");
  }

  const crumb = [{ label: "Skills Lab" }, { label: "CI Runs" }];

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: 28, maxWidth: 1200 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>CI Runs</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
            Runs ingested from GitHub Actions. Auto-refreshes every 20s.
          </p>
        </div>
        <FilterBar filters={filters} onChange={handleFiltersChange} />
        <CiRunsTable
          runs={data}
          isLoading={isLoading}
          error={error as Error | null}
        />
      </div>
    </AppShell>
  );
}
