/* AgentPerformanceView unit tests (AC-E1, AC-E2, AC-ST1, Edge 14). */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { AgentPerformance } from "@devdigest/shared";
import { AgentPerformanceView } from "./AgentPerformanceView";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

const DATA: AgentPerformance = {
  window: "30",
  total_runs: 12,
  total_cost_usd: 3.5,
  cost_delta_usd: 1.25,
  avg_accept_rate: 0.75,
  most_active_agent: { agent_id: "agent-1", agent_name: "Security Reviewer", runs: 8 },
  agents: [
    {
      agent_id: "agent-1",
      agent_name: "Security Reviewer",
      runs: 8,
      avg_cost_usd: 0.02,
      avg_duration_ms: 4200,
      accept_rate: 0.5,
      trend: "up",
      last_run_at: new Date("2026-01-16T12:00:00Z").toISOString(),
    },
    {
      agent_id: "agent-2",
      agent_name: "<script>alert(1)</script>",
      runs: 4,
      avg_cost_usd: null,
      avg_duration_ms: null,
      accept_rate: null,
      trend: null,
      last_run_at: null,
    },
  ],
  cost_by_agent: [{ key: "Security Reviewer", cost_usd: 3.0 }],
  cost_by_model: [{ key: "gpt-4o", cost_usd: 3.5 }],
};

const EMPTY_DATA: AgentPerformance = {
  window: "30",
  total_runs: 0,
  total_cost_usd: 0,
  cost_delta_usd: null,
  avg_accept_rate: null,
  most_active_agent: null,
  agents: [],
  cost_by_agent: [],
  cost_by_model: [],
};

describe("AgentPerformanceView", () => {
  it("shows a loading skeleton while data is pending", () => {
    render(
      <AgentPerformanceView data={undefined} isLoading window="30" onWindowChange={vi.fn()} />,
    );
    expect(screen.getByText("Agent Performance")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no runs in the window (AC-ST1)", () => {
    render(
      <AgentPerformanceView
        data={EMPTY_DATA}
        isLoading={false}
        window="30"
        onWindowChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/no runs in this window/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it(
    "renders stat cards, per-agent table rows (with '—' for null accept rate), " +
      "a View link to the agent CI tab, and inert agent-name strings — and lets the " +
      "user switch the time window (AC-E2, Edge 14)",
    () => {
      const onWindowChange = vi.fn();
      render(
        <AgentPerformanceView
          data={DATA}
          isLoading={false}
          window="30"
          onWindowChange={onWindowChange}
        />,
      );

      // Stat cards
      expect(screen.getByText("TOTAL RUNS")).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
      expect(screen.getByText("$3.5000")).toBeInTheDocument();
      expect(screen.getByText("+$1.2500")).toBeInTheDocument();

      // Table row for agent-1: accept rate rendered as a percent
      expect(screen.getByText("50%")).toBeInTheDocument();

      // Table row for agent-2: null accept rate renders as em-dash, not "0%" or "NaN%"
      const cells = screen.getAllByText("—");
      expect(cells.length).toBeGreaterThanOrEqual(1);

      // Malicious agent name is rendered as inert text, not executed/interpreted as HTML
      expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
      expect(document.querySelector("script[src]")).toBeNull();

      // View link points at the agent's CI tab (AC-E2)
      const viewLinks = screen.getAllByRole("link", { name: /view/i });
      expect(viewLinks[0]).toHaveAttribute("href", "/agents/agent-1?tab=ci");

      // Window selector: switching to 7 days notifies the parent
      fireEvent.click(screen.getByRole("radio", { name: "7 days" }));
      expect(onWindowChange).toHaveBeenCalledWith("7");
    },
  );
});
