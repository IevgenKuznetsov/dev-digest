/* EvalDashboardView unit tests. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EvalDashboardView } from "./EvalDashboardView";
import type { EvalWorkspaceDashboard } from "@devdigest/shared";

// Mock useRouter from next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/eval-dashboard",
}));

afterEach(cleanup);

const EMPTY_DATA: EvalWorkspaceDashboard = {
  agents: [],
  recent_batches: [],
};

const DATA_WITH_AGENTS: EvalWorkspaceDashboard = {
  agents: [
    {
      agent_id: "a1",
      agent_name: "Security Agent",
      agent_version: 3,
      last_ran_at: "2026-08-01T10:00:00Z",
      cases_total: 5,
      recall: 0.8,
      precision: 0.75,
      citation_accuracy: 0.9,
      traces_passed: 4,
      traces_total: 5,
      latest_status: "done",
    },
  ],
  recent_batches: [],
};

describe("EvalDashboardView", () => {
  it("renders empty state when no agents", () => {
    render(<EvalDashboardView data={EMPTY_DATA} isLoading={false} />);
    expect(screen.getByText(/No agents with eval data/i)).toBeInTheDocument();
  });

  it("renders agent card with agent name", () => {
    render(<EvalDashboardView data={DATA_WITH_AGENTS} isLoading={false} />);
    expect(screen.getByText("Security Agent")).toBeInTheDocument();
  });

  it("shows loading skeleton when isLoading", () => {
    render(<EvalDashboardView data={undefined} isLoading />);
    expect(screen.getByText("Eval Dashboard")).toBeInTheDocument();
  });
});
