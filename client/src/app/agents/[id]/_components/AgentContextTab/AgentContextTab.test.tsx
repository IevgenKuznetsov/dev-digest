import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the project-context hooks (no real API needed).
vi.mock("@/lib/hooks/project-context", () => ({
  useAgentContext: vi.fn(),
  useSetAgentContext: vi.fn(),
  useContextDocs: vi.fn(),
}));

// Mock the repo-context so useActiveRepo returns a fixed repo.
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", name: "acme/payments-api" } }),
}));

import * as hooks from "@/lib/hooks/project-context";
import { AgentContextTab } from "./AgentContextTab";

afterEach(cleanup);

// ---- Sample data ----

function makeDoc(id: string, path: string, category: "specs" | "docs" | "insights" | "other", tokens = 100) {
  return { id, repoId: "repo-1", workspaceId: "ws-1", path, category, tokens, scannedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
}

const ATTACHED_DOC = { ...makeDoc("doc-1", "specs/security-baseline.md", "specs", 120), order: 0 };
const AVAILABLE_DOC = makeDoc("doc-2", "docs/architecture.md", "docs", 80);

function setupHooks({
  attached = [ATTACHED_DOC],
  totalAvailable = 2,
  allDocs = [ATTACHED_DOC, AVAILABLE_DOC],
}: {
  attached?: typeof ATTACHED_DOC[];
  totalAvailable?: number;
  allDocs?: ReturnType<typeof makeDoc>[];
} = {}) {
  vi.mocked(hooks.useAgentContext).mockReturnValue({
    data: { attached, totalAvailable },
    isLoading: false,
    isError: false,
  } as ReturnType<typeof hooks.useAgentContext>);

  vi.mocked(hooks.useContextDocs).mockReturnValue({
    data: allDocs,
    isLoading: false,
  } as ReturnType<typeof hooks.useContextDocs>);

  vi.mocked(hooks.useSetAgentContext).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useSetAgentContext>);
}

function renderTab(agentId = "agent-1") {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AgentContextTab agentId={agentId} />
    </QueryClientProvider>,
  );
}

// ====================================================== Tests

describe("AgentContextTab", () => {
  it('renders "N of M attached" label reflecting current attachment state', () => {
    setupHooks({ attached: [ATTACHED_DOC], totalAvailable: 2 });
    renderTab();

    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();
  });

  it("shows attached docs with checked checkbox and unattached docs with unchecked", () => {
    setupHooks({ attached: [ATTACHED_DOC], totalAvailable: 2, allDocs: [ATTACHED_DOC, AVAILABLE_DOC] });
    renderTab();

    // Attached doc: aria-label "Detach specs/security-baseline.md"
    const detachBox = screen.getByRole("checkbox", { name: /detach specs\/security-baseline\.md/i });
    expect(detachBox).toBeChecked();

    // Unattached doc: aria-label "Attach docs/architecture.md"
    const attachBox = screen.getByRole("checkbox", { name: /attach docs\/architecture\.md/i });
    expect(attachBox).not.toBeChecked();
  });

  it("shows empty message when no docs exist for the repo", () => {
    setupHooks({ attached: [], totalAvailable: 0, allDocs: [] });
    renderTab();

    expect(screen.getByText(/no context documents found/i)).toBeInTheDocument();
  });

  it('shows token total footer when docs are attached', () => {
    setupHooks({ attached: [ATTACHED_DOC], totalAvailable: 1 });
    renderTab();

    // The footer shows "120 tokens" as the aggregate count.
    expect(screen.getByText(/120\s+tokens/)).toBeInTheDocument();
  });
});
