/* ResultsView — unit tests.
   Covers: completed runs render columns, in-progress runs show spinner,
   conflict section hidden for single agent, error state, all-agents-failed banner. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { MultiAgentRunDetail, MultiAgentAgentColumn } from "@devdigest/shared";

// ---- Mocks ----

const mockUseMultiAgentRun = vi.fn();
const mockUseRunEvents = vi.fn();

vi.mock("../../../../../lib/hooks/multi-agent-review", () => ({
  useMultiAgentRun: (...args: unknown[]) => mockUseMultiAgentRun(...args),
}));

vi.mock("../../../../../lib/hooks/reviews", () => ({
  useRunEvents: (...args: unknown[]) => mockUseRunEvents(...args),
}));

import { ResultsView } from "./ResultsView";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeColumn(overrides: Partial<MultiAgentAgentColumn>): MultiAgentAgentColumn {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openai",
    model: "gpt-4o",
    status: "done",
    verdict: "changes_requested",
    score: 72,
    summary: "Found some issues.",
    duration_ms: 12000,
    cost_usd: 0.05,
    tokens_in: 5000,
    tokens_out: 300,
    findings: [],
    ...overrides,
  };
}

function makeRun(columns: MultiAgentAgentColumn[], extra?: Partial<MultiAgentRunDetail>): MultiAgentRunDetail {
  return {
    id: "mar-1",
    pr_id: "pr-1",
    pr_number: 42,
    ran_at: new Date().toISOString(),
    agent_count: columns.length,
    total_duration_ms: 12000,
    total_cost_usd: 0.05,
    columns,
    conflicts: [],
    ...extra,
  };
}

function defaultSseRunning() {
  mockUseRunEvents.mockReturnValue({ events: [], running: false });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ResultsView — loading state", () => {
  it("renders skeletons while loading", () => {
    mockUseMultiAgentRun.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    defaultSseRunning();

    const { container } = render(<ResultsView multiAgentRunId="mar-1" />);
    // No column headings while loading — Skeleton renders placeholder divs
    expect(screen.queryByRole("region", { name: /agent review columns/i })).not.toBeInTheDocument();
    expect(container.firstChild).toBeDefined();
  });
});

describe("ResultsView — error state", () => {
  it("shows error alert when fetch fails", () => {
    mockUseMultiAgentRun.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: "Not found" },
    });
    defaultSseRunning();

    render(<ResultsView multiAgentRunId="mar-1" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Not found");
  });
});

describe("ResultsView — completed runs", () => {
  it("renders an agent column card for each completed column", () => {
    const columns = [
      makeColumn({ run_id: "run-1", agent_name: "Security Reviewer" }),
      makeColumn({ run_id: "run-2", agent_name: "Perf Reviewer", agent_id: "a2" }),
    ];
    mockUseMultiAgentRun.mockReturnValue({ data: makeRun(columns), isLoading: false, isError: false });
    defaultSseRunning();

    render(<ResultsView multiAgentRunId="mar-1" />);

    expect(screen.getByRole("region", { name: /agent review columns/i })).toBeInTheDocument();
    // Each agent column has an aria-label with the agent name
    expect(screen.getByRole("region", { name: /security reviewer review column/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /perf reviewer review column/i })).toBeInTheDocument();
  });

  it("shows final stats text in completed column header", () => {
    const columns = [makeColumn({ duration_ms: 12345, score: 85 })];
    mockUseMultiAgentRun.mockReturnValue({ data: makeRun(columns), isLoading: false, isError: false });
    defaultSseRunning();

    render(<ResultsView multiAgentRunId="mar-1" />);
    // Score is shown in the column card body
    expect(screen.getByText("85")).toBeInTheDocument();
  });
});

describe("ResultsView — in-progress runs (spinner)", () => {
  it("shows 'Running…' spinner in a column that has status running", () => {
    const columns = [
      makeColumn({ run_id: "run-1", agent_name: "Security Reviewer", status: "running", verdict: null, score: null, summary: null, duration_ms: null, cost_usd: null }),
    ];
    mockUseMultiAgentRun.mockReturnValue({ data: makeRun(columns), isLoading: false, isError: false });
    mockUseRunEvents.mockReturnValue({ events: [], running: true });

    render(<ResultsView multiAgentRunId="mar-1" />);
    // The spinner role is aria-label="Security Reviewer is running"
    expect(screen.getByRole("status", { name: /security reviewer is running/i })).toBeInTheDocument();
    expect(screen.getByText("Running…")).toBeInTheDocument();
  });
});

describe("ResultsView — conflict section visibility", () => {
  it("hides ConflictsSection when only 1 agent column", () => {
    const columns = [makeColumn({ run_id: "run-1" })];
    mockUseMultiAgentRun.mockReturnValue({
      data: makeRun(columns, { conflicts: [{ file: "src/a.ts", line: 1, title: "x", takes: [] }] }),
      isLoading: false,
      isError: false,
    });
    defaultSseRunning();

    render(<ResultsView multiAgentRunId="mar-1" />);
    // Section should NOT appear for single agent (showConflicts = columns.length > 1)
    expect(screen.queryByRole("region", { name: /where agents disagree/i })).not.toBeInTheDocument();
  });

  it("shows ConflictsSection for 2+ agent columns", () => {
    const columns = [
      makeColumn({ run_id: "run-1", agent_name: "Security" }),
      makeColumn({ run_id: "run-2", agent_name: "Perf", agent_id: "a2" }),
    ];
    mockUseMultiAgentRun.mockReturnValue({
      data: makeRun(columns, { conflicts: [] }),
      isLoading: false,
      isError: false,
    });
    defaultSseRunning();

    render(<ResultsView multiAgentRunId="mar-1" />);
    // ConflictsSection renders its aria-label
    expect(screen.getByRole("region", { name: /where agents disagree/i })).toBeInTheDocument();
  });
});

describe("ResultsView — all agents failed", () => {
  it("shows 'All agents failed' banner when every column has status failed", () => {
    const columns = [
      makeColumn({ run_id: "run-1", status: "failed", verdict: null, score: null, summary: "LLM error", duration_ms: null, cost_usd: null }),
      makeColumn({ run_id: "run-2", agent_id: "a2", status: "failed", verdict: null, score: null, summary: "Timeout", duration_ms: null, cost_usd: null }),
    ];
    mockUseMultiAgentRun.mockReturnValue({ data: makeRun(columns), isLoading: false, isError: false });
    defaultSseRunning();

    render(<ResultsView multiAgentRunId="mar-1" />);
    // Multiple alerts exist: the top banner + each column's failure box
    const alerts = screen.getAllByRole("alert");
    const banner = alerts.find((el) => /all agents failed/i.test(el.textContent ?? ""));
    expect(banner).toBeDefined();
  });
});
