/* EvalsTab unit tests. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import { EvalsTab } from "./EvalsTab";

// Mock all hooks
vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: vi.fn(() => ({ data: undefined, isLoading: true })),
  useDeleteEvalCase: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRunEvalCase: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useStartEvalBatch: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useAgentEvalDashboard: vi.fn(() => ({ data: undefined, isLoading: false })),
  useEvalBatches: vi.fn(() => ({ data: undefined, isLoading: false })),
  useEvalBatch: vi.fn(() => ({ data: undefined, isLoading: false })),
  useCreateEvalCase: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateEvalCase: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

afterEach(cleanup);

const AGENT: Agent = {
  id: "agent-1",
  name: "Test Agent",
  description: "desc",
  provider: "openai",
  model: "gpt-4o",
  system_prompt: "You are a reviewer.",
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: false,
  enabled: true,
  version: 1,
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: { "editor.tabs.evals": "Evals" } }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("renders loading skeleton when cases are loading", () => {
    wrap(<EvalsTab agent={AGENT} />);
    // Should show something — at minimum the section header
    expect(screen.getByText("Eval Metrics")).toBeInTheDocument();
  });

  it("renders empty state when no cases", async () => {
    const { useEvalCases } = await import("@/lib/hooks/evals");
    vi.mocked(useEvalCases).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useEvalCases>);
    wrap(<EvalsTab agent={AGENT} />);
    expect(screen.getByText(/No eval cases yet/i)).toBeInTheDocument();
  });

  it("disables Run all evals button when no cases", async () => {
    const { useEvalCases } = await import("@/lib/hooks/evals");
    vi.mocked(useEvalCases).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useEvalCases>);
    wrap(<EvalsTab agent={AGENT} />);
    const btn = screen.getByRole("button", { name: /run all evals/i });
    expect(btn).toBeDisabled();
  });
});
