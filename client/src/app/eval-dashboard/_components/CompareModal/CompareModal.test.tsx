/* CompareModal unit tests — renders metric deltas, promote button, case flips. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CompareModal } from "./CompareModal";
import type { EvalBatchComparison } from "@devdigest/shared";

// Mock hooks
vi.mock("@/lib/hooks/evals", () => ({
  useCompareBatches: vi.fn(),
  usePromoteAgentVersion: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock("@/lib/toast", () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

// Mock Modal from vendor/ui to avoid complex portal setup
vi.mock("@devdigest/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Modal: ({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) => (
      <div role="dialog" aria-label={title}>
        <div data-testid="modal-title">{title}</div>
        <div data-testid="modal-body">{children}</div>
        {footer && <div data-testid="modal-footer">{footer}</div>}
      </div>
    ),
    Skeleton: () => <div data-testid="skeleton">Loading…</div>,
  };
});

afterEach(cleanup);

function makeDelta(a: number | null, b: number | null) {
  return {
    a,
    b,
    delta: a != null && b != null ? b - a : null,
  };
}

const COMPARISON_DATA: EvalBatchComparison = {
  batch_a: {
    id: "batch-a",
    owner_id: "agent-1",
    owner_kind: "agent",
    agent_version: 2,
    ran_at: "2026-08-01T10:00:00Z",
    status: "done",
    recall: 0.7,
    precision: 0.8,
    citation_accuracy: 0.9,
    traces_total: 5,
    traces_passed: 4,
    cost_usd: 0.05,
    duration_ms: 3000,
  },
  batch_b: {
    id: "batch-b",
    owner_id: "agent-1",
    owner_kind: "agent",
    agent_version: 3,
    ran_at: "2026-08-10T10:00:00Z",
    status: "done",
    recall: 0.8,
    precision: 0.75,
    citation_accuracy: 0.85,
    traces_total: 5,
    traces_passed: 5,
    cost_usd: 0.06,
    duration_ms: 2800,
  },
  recall: makeDelta(0.7, 0.8),
  precision: makeDelta(0.8, 0.75),
  citation_accuracy: makeDelta(0.9, 0.85),
  pass_fraction: makeDelta(0.8, 1.0),
  cost_usd: makeDelta(0.05, 0.06),
  system_prompt_a: "You are a code reviewer.",
  system_prompt_b: "You are a precise code reviewer.",
  case_flips: [
    {
      case_id: "case-x",
      case_name: "Should detect SQL injection",
      regression: true,
      pass_a: true,
      pass_b: false,
    },
  ],
};

async function getEvalsHooks() {
  return import("@/lib/hooks/evals");
}

describe("CompareModal", () => {
  it("shows loading skeleton while data is fetching", async () => {
    const hooks = await getEvalsHooks();
    vi.mocked(hooks.useCompareBatches).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof hooks.useCompareBatches>);

    render(
      <CompareModal batchIdA="batch-a" batchIdB="batch-b" agentId="agent-1" onClose={vi.fn()} />,
    );
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  it("renders metric deltas and version header when data is loaded", async () => {
    const hooks = await getEvalsHooks();
    vi.mocked(hooks.useCompareBatches).mockReturnValue({
      data: COMPARISON_DATA,
      isLoading: false,
    } as ReturnType<typeof hooks.useCompareBatches>);

    render(
      <CompareModal batchIdA="batch-a" batchIdB="batch-b" agentId="agent-1" onClose={vi.fn()} />,
    );

    // Header contains version numbers
    expect(screen.getByTestId("modal-title")).toHaveTextContent(/v2.*v3/i);

    // Metric delta section is shown
    expect(screen.getByText("Metric Deltas")).toBeInTheDocument();
    expect(screen.getByText("Recall")).toBeInTheDocument();
    expect(screen.getByText("Precision")).toBeInTheDocument();
    expect(screen.getByText("Citation Accuracy")).toBeInTheDocument();
  });

  it("renders system prompt diff section when prompts differ", async () => {
    const hooks = await getEvalsHooks();
    vi.mocked(hooks.useCompareBatches).mockReturnValue({
      data: COMPARISON_DATA,
      isLoading: false,
    } as ReturnType<typeof hooks.useCompareBatches>);

    render(
      <CompareModal batchIdA="batch-a" batchIdB="batch-b" agentId="agent-1" onClose={vi.fn()} />,
    );

    expect(screen.getByLabelText("System prompt diff")).toBeInTheDocument();
  });

  it("shows Case changes toggle button when flips exist and expands on click", async () => {
    const hooks = await getEvalsHooks();
    vi.mocked(hooks.useCompareBatches).mockReturnValue({
      data: COMPARISON_DATA,
      isLoading: false,
    } as ReturnType<typeof hooks.useCompareBatches>);

    render(
      <CompareModal batchIdA="batch-a" batchIdB="batch-b" agentId="agent-1" onClose={vi.fn()} />,
    );

    // The collapsible trigger
    const toggle = screen.getByRole("button", { name: /case changes/i });
    expect(toggle).toBeInTheDocument();

    // Case flip content is hidden until toggle
    expect(screen.queryByText("Should detect SQL injection")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("Should detect SQL injection")).toBeInTheDocument();
  });

  it("Promote button calls mutate with version A and then onClose on success", async () => {
    const hooks = await getEvalsHooks();
    const mutate = vi.fn().mockImplementation((_version: unknown, { onSuccess }: { onSuccess: () => void }) => {
      onSuccess();
    });

    vi.mocked(hooks.useCompareBatches).mockReturnValue({
      data: COMPARISON_DATA,
      isLoading: false,
    } as ReturnType<typeof hooks.useCompareBatches>);
    vi.mocked(hooks.usePromoteAgentVersion).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof hooks.usePromoteAgentVersion>);

    const onClose = vi.fn();
    render(
      <CompareModal batchIdA="batch-a" batchIdB="batch-b" agentId="agent-1" onClose={onClose} />,
    );

    const promoteBtn = screen.getByRole("button", { name: /promote v2/i });
    fireEvent.click(promoteBtn);

    expect(mutate).toHaveBeenCalledWith(2, expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Close button calls onClose", async () => {
    const hooks = await getEvalsHooks();
    vi.mocked(hooks.useCompareBatches).mockReturnValue({
      data: COMPARISON_DATA,
      isLoading: false,
    } as ReturnType<typeof hooks.useCompareBatches>);

    const onClose = vi.fn();
    render(
      <CompareModal batchIdA="batch-a" batchIdB="batch-b" agentId="agent-1" onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows error message when data is null (failed to load)", async () => {
    const hooks = await getEvalsHooks();
    vi.mocked(hooks.useCompareBatches).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof hooks.useCompareBatches>);

    render(
      <CompareModal batchIdA="batch-a" batchIdB="batch-b" agentId="agent-1" onClose={vi.fn()} />,
    );

    expect(screen.getByText(/Could not load comparison data/i)).toBeInTheDocument();
  });
});
