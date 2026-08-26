/* CiTab unit tests (AC-E8, AC-E1). */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { CiInstallation, CiRun } from "@devdigest/shared";
import { CiTab } from "./CiTab";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations: vi.fn(() => ({ data: undefined, isLoading: true, error: null })),
  useCiRuns: vi.fn(() => ({ data: undefined, isLoading: true, error: null })),
  useExportCi: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock("@/components/CiExportWizard", () => ({
  CiExportWizard: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="ci-export-wizard">
      <button onClick={onClose}>Close wizard</button>
    </div>
  ),
}));

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const AGENT: Agent = {
  id: "agent-1",
  name: "Security Reviewer",
  description: "Reviews security issues",
  provider: "openai",
  model: "gpt-4o",
  system_prompt: "You are a security reviewer.",
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: false,
  enabled: true,
  version: 3,
};

const INSTALLATION: CiInstallation & { agent_version: number } = {
  id: "inst-1",
  agent_id: "agent-1",
  repo: "acme/payments-api",
  target_type: "gha",
  installed_at: new Date("2026-01-15T10:00:00Z").toISOString(),
  agent_version: 2,
};

const RUN: CiRun = {
  id: "run-1",
  ci_installation_id: "inst-1",
  pr_number: 42,
  ran_at: new Date("2026-01-16T12:00:00Z").toISOString(),
  status: "succeeded",
  findings_count: 3,
  cost_usd: 0.0015,
  github_url: "https://github.com/acme/payments-api/actions/runs/123",
  source: "ci",
  agent: "Security Reviewer",
  duration_s: 8.4,
};

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{}}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CiTab", () => {
  it("renders heading, ci_fail_on setting, and Add to CI button while loading", () => {
    wrap(<CiTab agent={AGENT} />);

    expect(screen.getByText("Continuous Integration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add to ci/i })).toBeInTheDocument();
    // ci_fail_on label visible
    expect(screen.getByText("Fail CI on")).toBeInTheDocument();
    // actual ci_fail_on value
    expect(screen.getByText("Block on critical")).toBeInTheDocument();
  });

  it("renders installations with agentVersion as workflow version (AC-E8)", async () => {
    const { useCiInstallations, useCiRuns } = await import("@/lib/hooks/ci");
    vi.mocked(useCiInstallations).mockReturnValue({
      data: [INSTALLATION],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCiInstallations>);
    vi.mocked(useCiRuns).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCiRuns>);

    wrap(<CiTab agent={AGENT} />);

    // Repo name rendered
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();

    // Installed workflow version shows agent_version at install time (v2, not current v3)
    expect(screen.getByText(/Installed workflow version/)).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
  });

  it("renders run history rows", async () => {
    const { useCiInstallations, useCiRuns } = await import("@/lib/hooks/ci");
    vi.mocked(useCiInstallations).mockReturnValue({
      data: [INSTALLATION],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCiInstallations>);
    vi.mocked(useCiRuns).mockReturnValue({
      data: [RUN],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCiRuns>);

    wrap(<CiTab agent={AGENT} />);

    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByText("3 findings")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view job/i })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/actions/runs/123",
    );
  });

  it("shows empty state when no installations exist", async () => {
    const { useCiInstallations, useCiRuns } = await import("@/lib/hooks/ci");
    vi.mocked(useCiInstallations).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCiInstallations>);
    vi.mocked(useCiRuns).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCiRuns>);

    wrap(<CiTab agent={AGENT} />);

    expect(screen.getByText(/Not deployed to CI yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No CI runs yet/i)).toBeInTheDocument();
  });

  it("Add to CI button opens the Export Wizard modal (AC-E1)", async () => {
    const { useCiInstallations, useCiRuns } = await import("@/lib/hooks/ci");
    vi.mocked(useCiInstallations).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCiInstallations>);
    vi.mocked(useCiRuns).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useCiRuns>);

    wrap(<CiTab agent={AGENT} />);

    // Wizard not visible before click
    expect(screen.queryByTestId("ci-export-wizard")).not.toBeInTheDocument();

    // Click "Add to CI"
    fireEvent.click(screen.getByRole("button", { name: /add to ci/i }));

    // Wizard renders
    expect(screen.getByTestId("ci-export-wizard")).toBeInTheDocument();

    // Close wizard
    fireEvent.click(screen.getByRole("button", { name: /close wizard/i }));
    expect(screen.queryByTestId("ci-export-wizard")).not.toBeInTheDocument();
  });
});
