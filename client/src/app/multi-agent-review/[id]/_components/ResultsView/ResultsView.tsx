/* ResultsView — side-by-side agent column comparison for a multi-agent run. */
"use client";

import React from "react";
import { Skeleton } from "@devdigest/ui";
import { useMultiAgentRun } from "../../../../../lib/hooks/multi-agent-review";
import { useRunEvents } from "../../../../../lib/hooks/reviews";
import { AgentColumnCard } from "../AgentColumnCard";
import { ConflictsSection } from "../ConflictsSection";
import { isRunComplete, allRunsFailed, computeElapsed } from "./helpers";
import { SKELETON_COLUMNS } from "./constants";

const s = {
  page: {
    padding: 28,
    maxWidth: 1400,
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
  columnsContainer: {
    display: "flex",
    gap: 16,
    overflowX: "auto" as const,
    paddingBottom: 8,
  },
  skeletonRow: {
    display: "flex",
    gap: 16,
  },
  errorBox: {
    padding: "20px 24px",
    borderRadius: 8,
    border: "1px solid var(--error-border, rgba(239,68,68,0.2))",
    backgroundColor: "var(--error-subtle, rgba(239,68,68,0.08))",
    color: "var(--error, #ef4444)",
    fontSize: 14,
  },
  loadingState: {
    fontSize: 14,
    color: "var(--text-muted)",
    padding: "24px 0",
  },
};

interface ResultsViewProps {
  multiAgentRunId: string;
}

export function ResultsView({ multiAgentRunId }: ResultsViewProps) {
  const { data: run, isLoading, isError, error } = useMultiAgentRun(multiAgentRunId);

  // Track elapsed time for running columns (updates every second while running)
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!run?.ran_at) return;
    const complete = isRunComplete(run.columns);
    if (complete) return;
    const interval = setInterval(() => {
      setElapsed(computeElapsed(run.ran_at));
    }, 1_000);
    return () => clearInterval(interval);
  }, [run?.ran_at, run?.columns]);

  // Track SSE connection loss per running column
  const [connectionLost, setConnectionLost] = React.useState<Record<string, boolean>>({});

  // Collect run IDs for in-progress columns
  const runningRunIds = React.useMemo(
    () => (run?.columns ?? []).filter((c) => c.status === "running").map((c) => c.run_id),
    [run?.columns],
  );

  // Subscribe to SSE for running columns. useRunEvents handles onerror → closes EventSource.
  // We detect connection loss by observing the `running` flag going false while DB still says running.
  const { running: sseRunning } = useRunEvents(runningRunIds);

  // Whether SSE has actually connected for the current set of running runs. On
  // mount `sseRunning` is false until useRunEvents opens the EventSources, so we
  // must NOT treat that initial false as a dropped connection (that flagged every
  // column as "Connection lost" immediately). Only a true→false transition counts.
  const sseHasConnected = React.useRef(false);

  React.useEffect(() => {
    if (runningRunIds.length === 0) {
      sseHasConnected.current = false;
      return;
    }
    if (sseRunning) {
      // Connected (or reconnected) — remember it and clear any stale lost flags.
      sseHasConnected.current = true;
      setConnectionLost((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    // SSE reports not-running while DB still shows running — only a genuine drop
    // (we were connected before) counts as a lost connection.
    if (sseHasConnected.current) {
      const lostMap: Record<string, boolean> = {};
      for (const id of runningRunIds) {
        lostMap[id] = true;
      }
      setConnectionLost((prev) => ({ ...prev, ...lostMap }));
    }
  }, [sseRunning, runningRunIds]);

  // Clear connection lost flags once a column finishes
  React.useEffect(() => {
    if (!run) return;
    const completedIds = run.columns
      .filter((c) => c.status !== "running")
      .map((c) => c.run_id);
    if (completedIds.length === 0) return;
    setConnectionLost((prev) => {
      const next = { ...prev };
      for (const id of completedIds) delete next[id];
      return next;
    });
  }, [run]);

  // --- Render states ---

  if (isLoading) {
    return (
      <div style={s.page}>
        <div style={s.skeletonRow}>
          {Array.from({ length: SKELETON_COLUMNS }).map((_, i) => (
            <Skeleton key={i} height={320} width={300} />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !run) {
    const msg = (error as { message?: string })?.message ?? "Failed to load multi-agent run.";
    return (
      <div style={s.page}>
        <div style={s.errorBox} role="alert">
          <strong>Error:</strong> {msg}
        </div>
      </div>
    );
  }

  const columns = run.columns;
  const allFailed = allRunsFailed(columns);
  const showConflicts = columns.length > 1;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.h1}>Multi-Agent Review</h1>
        <p style={s.subtitle}>
          {columns.length} agent{columns.length !== 1 ? "s" : ""} ·{" "}
          {run.conflicts?.length ?? 0} conflict{(run.conflicts?.length ?? 0) !== 1 ? "s" : ""}{" "}
          detected
        </p>
      </div>

      {allFailed && (
        <div style={{ ...s.errorBox, marginBottom: 20 }} role="alert">
          <strong>All agents failed.</strong> See each column for details.
        </div>
      )}

      {/* Side-by-side columns — horizontally scrollable for 5+ agents */}
      <div style={s.columnsContainer} role="region" aria-label="Agent review columns">
        {columns.map((column) => (
          <AgentColumnCard
            key={column.run_id}
            column={column}
            connectionLost={connectionLost[column.run_id]}
            elapsed={column.status === "running" ? elapsed : undefined}
          />
        ))}
      </div>

      {/* Conflicts section — hidden when only 1 agent (no comparison possible) */}
      {showConflicts && <ConflictsSection conflicts={run.conflicts ?? []} />}
    </div>
  );
}
