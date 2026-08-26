/* ConfigureView — orchestrates the multi-agent review configuration page.
   PR picker + agent checkboxes + estimate panel + Run button. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@devdigest/ui";
import { useAgents } from "../../../../../lib/hooks/agents";
import { usePulls } from "../../../../../lib/hooks/core";
import {
  useAgentEstimates,
  useCreateMultiAgentRun,
} from "../../../../../lib/hooks/multi-agent-review";
import { useActiveRepo } from "../../../../../lib/repo-context";
import { AgentCheckboxList } from "../AgentCheckboxList";
import { EstimatePanel } from "../EstimatePanel";
import type { AgentEstimate } from "@devdigest/shared";

const s = {
  page: {
    padding: 28,
    maxWidth: 900,
  },
  header: {
    marginBottom: 24,
  },
  h1: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: "var(--text-muted)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 340px",
    gap: 24,
    alignItems: "start",
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    marginBottom: 10,
  },
  select: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--border-subtle)",
    backgroundColor: "var(--surface-2)",
    color: "var(--text-primary)",
    fontSize: 14,
    appearance: "none" as const,
    cursor: "pointer",
  },
  sidePanel: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  },
  runButton: (disabled: boolean) => ({
    width: "100%",
    padding: "12px 20px",
    borderRadius: 6,
    border: "none",
    backgroundColor: disabled ? "var(--surface-3)" : "var(--accent)",
    color: disabled ? "var(--text-muted)" : "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background-color 0.15s",
  }),
  error: {
    fontSize: 13,
    color: "var(--error)",
    padding: "8px 12px",
    borderRadius: 6,
    backgroundColor: "var(--error-subtle)",
    border: "1px solid var(--error-border)",
  },
};

export function ConfigureView() {
  const router = useRouter();
  const { repoId } = useActiveRepo();

  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: estimatesData } = useAgentEstimates();
  const createRun = useCreateMultiAgentRun();

  const [selectedPrId, setSelectedPrId] = React.useState<string>("");
  const [selectedAgentIds, setSelectedAgentIds] = React.useState<Set<string>>(() => {
    // Default: all enabled agents checked
    return new Set();
  });

  // Once agents load, default-select enabled ones
  const agentsRef = React.useRef(false);
  React.useEffect(() => {
    if (agents && !agentsRef.current) {
      agentsRef.current = true;
      setSelectedAgentIds(new Set(agents.filter((a) => a.enabled).map((a) => a.id)));
    }
  }, [agents]);

  const handleAgentChange = (id: string, checked: boolean) => {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  // Compute estimate for selected agents
  const allEstimates: AgentEstimate[] = estimatesData?.agents ?? [];
  const selectedEstimates = allEstimates.filter((e) => selectedAgentIds.has(e.agent_id));

  const totalCostUsd = selectedEstimates.some((e) => e.cost_usd != null)
    ? selectedEstimates.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0)
    : null;

  const totalDurationMs = selectedEstimates.some((e) => e.duration_ms != null)
    ? Math.max(
        0,
        ...selectedEstimates.filter((e) => e.duration_ms != null).map((e) => e.duration_ms!),
      )
    : null;

  const isPartial = selectedEstimates.some((e) => e.cost_usd == null || e.duration_ms == null);

  const canRun = !!selectedPrId && selectedAgentIds.size > 0 && !createRun.isPending;

  const handleRun = () => {
    if (!canRun) return;
    createRun.mutate(
      { prId: selectedPrId, agent_ids: [...selectedAgentIds] },
      {
        onSuccess: (result) => {
          router.push(`/multi-agent-review/${result.id}`);
        },
      },
    );
  };

  const isLoading = pullsLoading || agentsLoading;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.h1}>Configure Multi-Agent Review</h1>
        <p style={s.subtitle}>
          Select a pull request and the agents to review it. Agents run in parallel.
        </p>
      </div>

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton height={40} />
          <Skeleton height={200} />
        </div>
      ) : (
        <div style={s.grid}>
          {/* Left column: PR picker + Agent checkboxes */}
          <div>
            <div style={s.section}>
              <div style={s.sectionLabel}>Pull Request</div>
              <select
                style={s.select}
                value={selectedPrId}
                onChange={(e) => setSelectedPrId(e.target.value)}
                aria-label="Select pull request"
              >
                <option value="">— Select a pull request —</option>
                {(pulls ?? [])
                  .filter((pr) => pr.id != null)
                  .map((pr) => (
                    <option key={pr.id!} value={pr.id!}>
                      #{pr.number} — {pr.title}
                    </option>
                  ))}
              </select>
            </div>

            <div style={s.section}>
              <div style={s.sectionLabel}>
                Agents{" "}
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                  ({selectedAgentIds.size} selected)
                </span>
              </div>
              <AgentCheckboxList
                agents={agents ?? []}
                selectedIds={selectedAgentIds}
                onChange={handleAgentChange}
              />
            </div>
          </div>

          {/* Right column: estimate panel + run button */}
          <div style={s.sidePanel}>
            <EstimatePanel
              selectedEstimates={selectedEstimates}
              totalCostUsd={totalCostUsd}
              totalDurationMs={totalDurationMs}
              isPartial={isPartial}
            />

            {createRun.error && (
              <div style={s.error} role="alert">
                {(createRun.error as { message?: string })?.message ?? "Failed to start run."}
              </div>
            )}

            <button
              style={s.runButton(!canRun)}
              onClick={handleRun}
              disabled={!canRun}
              aria-label="Start multi-agent review"
            >
              {createRun.isPending ? "Starting..." : "Run Multi-Agent Review"}
            </button>

            {!selectedPrId && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
                Select a pull request to enable the Run button.
              </p>
            )}
            {selectedPrId && selectedAgentIds.size === 0 && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
                Select at least one agent to enable the Run button.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
