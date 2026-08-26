/* CiRunsTable unit tests (AC-E7, AC-ST3). */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CiRunsTable } from "./CiRunsTable";
import type { CiRun } from "@devdigest/shared";

afterEach(cleanup);

const MOCK_RUNS: CiRun[] = [
  {
    id: "run-1",
    ci_installation_id: "inst-1",
    pr_number: 42,
    ran_at: "2026-08-25T10:00:00Z",
    status: "succeeded",
    findings_count: 3,
    cost_usd: 0.0045,
    github_url: "https://github.com/owner/repo/actions/runs/123",
    source: "ci",
    agent: "Security Agent",
    duration_s: 12.5,
  },
  {
    id: "run-2",
    ci_installation_id: "inst-1",
    pr_number: 43,
    ran_at: "2026-08-24T09:00:00Z",
    status: "failed",
    findings_count: 7,
    cost_usd: 0.006,
    github_url: null,
    source: "ci",
    agent: "Security Agent",
    duration_s: 8.2,
  },
];

describe("CiRunsTable", () => {
  it("renders column headers", () => {
    render(<CiRunsTable runs={[]} isLoading={false} error={null} />);
    expect(screen.getByText("Repository")).toBeInTheDocument();
    expect(screen.getByText("PR")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("Findings")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Trace / Job")).toBeInTheDocument();
  });

  it("renders run rows from mocked useCiRuns data", () => {
    render(<CiRunsTable runs={MOCK_RUNS} isLoading={false} error={null} />);
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("#43")).toBeInTheDocument();
    // agent name should appear at least once
    expect(screen.getAllByText("Security Agent").length).toBeGreaterThanOrEqual(1);
    // status badges
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    // duration
    expect(screen.getByText("12.5s")).toBeInTheDocument();
  });

  it("renders github link when github_url present", () => {
    render(<CiRunsTable runs={MOCK_RUNS} isLoading={false} error={null} />);
    const link = screen.getByRole("link", { name: /view/i });
    expect(link).toHaveAttribute("href", "https://github.com/owner/repo/actions/runs/123");
  });

  it("renders skeleton rows while loading", () => {
    render(<CiRunsTable runs={undefined} isLoading={true} error={null} />);
    // Header should still be present
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("renders empty state when no runs", () => {
    render(<CiRunsTable runs={[]} isLoading={false} error={null} />);
    expect(screen.getByText(/No CI runs found/i)).toBeInTheDocument();
  });

  it("renders error state when error is provided", () => {
    render(
      <CiRunsTable runs={undefined} isLoading={false} error={new Error("Network error")} />,
    );
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });
});
