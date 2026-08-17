/**
 * Component tests for PrBriefCard.
 * All hooks are mocked — no API calls.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock hooks before importing the component.
vi.mock("@/lib/hooks/risk-brief", () => ({
  useRiskBrief: vi.fn(),
  useGenerateRiskBrief: vi.fn(),
}));

// Mock Next.js navigation hooks.
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  usePathname: vi.fn(() => "/repos/repo-1/pulls/1"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

import * as riskBriefHooks from "@/lib/hooks/risk-brief";
import { PrBriefCard } from "./PrBriefCard";
import type { FindingRecord, RiskBriefResponse } from "@devdigest/shared";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---- Fixtures ----

const PR_ID = "pr-uuid-1234";
const HEAD_SHA = "abc123";

function makeFinding(severity: string, id: string): FindingRecord {
  return {
    id,
    review_id: "rev-1",
    file: "src/auth.ts",
    start_line: 1,
    end_line: 5,
    severity: severity as FindingRecord["severity"],
    category: "security",
    title: "Test finding",
    rationale: "Because",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    accepted_at: null,
    dismissed_at: null,
  };
}

const BRIEF_DATA: RiskBriefResponse = {
  brief: {
    what: "Adds rate limiting to the auth endpoint",
    why: "Prevents brute force attacks",
    risk_level: "high",
    risks: [
      {
        title: "Auth bypass risk",
        description: "Could allow bypass if misconfigured",
        file_refs: [{ file: "src/auth.ts", line: 42 }],
      },
    ],
    review_focus: [
      {
        file: "src/middleware.ts",
        line: 10,
        note: "Check rate limit logic carefully",
      },
    ],
  },
  head_sha: HEAD_SHA,
  model: "gpt-4.1",
  generated_at: "2026-08-17T12:00:00.000Z",
};

function renderCard(props: { findings?: FindingRecord[] } = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <PrBriefCard
        prId={PR_ID}
        headSha={HEAD_SHA}
        allFindings={props.findings ?? []}
      />
    </QueryClientProvider>,
  );
}

function mockNeverGenerated() {
  vi.mocked(riskBriefHooks.useRiskBrief).mockReturnValue({
    data: null,
    isLoading: false,
  } as never);
  vi.mocked(riskBriefHooks.useGenerateRiskBrief).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
}

function mockBriefLoaded(briefResponse = BRIEF_DATA) {
  vi.mocked(riskBriefHooks.useRiskBrief).mockReturnValue({
    data: briefResponse,
    isLoading: false,
  } as never);
  vi.mocked(riskBriefHooks.useGenerateRiskBrief).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
}

function mockServerGenerating() {
  vi.mocked(riskBriefHooks.useRiskBrief).mockReturnValue({
    data: { status: "generating" },
    isLoading: false,
  } as never);
  vi.mocked(riskBriefHooks.useGenerateRiskBrief).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
}

function mockLocallyGenerating() {
  vi.mocked(riskBriefHooks.useRiskBrief).mockReturnValue({
    data: null,
    isLoading: false,
  } as never);
  vi.mocked(riskBriefHooks.useGenerateRiskBrief).mockReturnValue({
    mutate: vi.fn(),
    isPending: true,
  } as never);
}

// ---- Tests ----

describe("PrBriefCard", () => {
  it("renders Generate brief button in never-generated state (AC-S1)", () => {
    mockNeverGenerated();
    renderCard();

    expect(screen.getByRole("button", { name: /generate risk brief/i })).toBeInTheDocument();
  });

  it("renders skeleton when locally generating (first time, AC-S2)", () => {
    mockLocallyGenerating();
    renderCard();

    // No "Generate brief" button — it's in skeleton state
    expect(screen.queryByRole("button", { name: /generate brief/i })).not.toBeInTheDocument();
  });

  it("renders skeleton when server reports generating (EC-10/GAP-2)", () => {
    mockServerGenerating();
    renderCard();

    // Should be in skeleton state, not showing "Generate brief"
    expect(screen.queryByRole("button", { name: /generate brief/i })).not.toBeInTheDocument();
    // Also should not show "Regenerate" button
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument();
  });

  it("renders all five sections when brief is loaded (AC-U2)", () => {
    mockBriefLoaded();
    renderCard();

    // Header row with title and risk level badge (REQ-46/GAP-4)
    expect(screen.getByText("Risk Brief")).toBeInTheDocument();
    // Risk level badge text label (not color-only) — AC-U6
    expect(screen.getByText("HIGH")).toBeInTheDocument();

    // What changed section
    expect(screen.getByText(/what changed/i)).toBeInTheDocument();
    expect(screen.getByText("Adds rate limiting to the auth endpoint")).toBeInTheDocument();

    // Why section
    expect(screen.getByText(/^why$/i)).toBeInTheDocument();
    expect(screen.getByText("Prevents brute force attacks")).toBeInTheDocument();

    // Risk areas
    expect(screen.getByText("Auth bypass risk")).toBeInTheDocument();

    // Review focus
    expect(screen.getByText(/check rate limit logic carefully/i)).toBeInTheDocument();
  });

  it("renders risk level badge with text label, not color-only (GAP-4/REQ-46)", () => {
    mockBriefLoaded();
    renderCard();

    // The badge must show text "HIGH", not just a colored element
    expect(screen.getByText("HIGH")).toBeInTheDocument();
  });

  it("renders what and why as plain p/text elements, not markdown (GAP-7/REQ-44/REQ-49)", () => {
    mockBriefLoaded();
    renderCard();

    const whatText = screen.getByText("Adds rate limiting to the auth endpoint");
    const whyText = screen.getByText("Prevents brute force attacks");

    // Verify they are plain elements (p/span), not markdown containers
    expect(whatText.tagName).toMatch(/^(P|SPAN)$/i);
    expect(whyText.tagName).toMatch(/^(P|SPAN)$/i);
  });

  it("shows Outdated badge when brief head_sha differs from current (AC-S4)", () => {
    mockBriefLoaded({
      ...BRIEF_DATA,
      head_sha: "old-sha-xxx",
    });
    renderCard(); // headSha prop is HEAD_SHA = 'abc123'

    expect(screen.getByText("Outdated")).toBeInTheDocument();
  });

  it("does not show Outdated badge when head_sha matches (AC-S4)", () => {
    mockBriefLoaded(); // brief.head_sha === HEAD_SHA === 'abc123'
    renderCard();

    expect(screen.queryByText("Outdated")).not.toBeInTheDocument();
  });

  it("shows findings summary row reflecting allFindings prop (AC-U3/AC-U4/EC-9)", () => {
    mockBriefLoaded();
    const findings = [
      makeFinding("CRITICAL", "f1"),
      makeFinding("CRITICAL", "f2"),
      makeFinding("CRITICAL", "f3"),
      makeFinding("WARNING", "f4"),
    ];
    renderCard({ findings });

    expect(screen.getByText(/3 blockers/i)).toBeInTheDocument();
    expect(screen.getByText(/4 total findings/i)).toBeInTheDocument();
  });

  it("shows No findings yet when allFindings is empty", () => {
    mockBriefLoaded();
    renderCard({ findings: [] });

    expect(screen.getByText(/no findings yet/i)).toBeInTheDocument();
  });

  it("shows 1 blocker (singular) when exactly one critical finding", () => {
    mockBriefLoaded();
    const findings = [makeFinding("CRITICAL", "f1")];
    renderCard({ findings });

    expect(screen.getByText(/1 blocker$/i)).toBeInTheDocument();
  });

  it("findings summary reflects prop, not cached brief (EC-9)", () => {
    mockBriefLoaded();
    const { rerender } = renderCard({ findings: [makeFinding("CRITICAL", "f1"), makeFinding("CRITICAL", "f2"), makeFinding("CRITICAL", "f3")] });

    // First render: 3 blockers
    expect(screen.getByText(/3 blockers/i)).toBeInTheDocument();

    // Re-render with updated findings
    const qc = new QueryClient();
    rerender(
      <QueryClientProvider client={qc}>
        <PrBriefCard prId={PR_ID} headSha={HEAD_SHA} allFindings={[makeFinding("CRITICAL", "f1")]} />
      </QueryClientProvider>,
    );

    // Should now show 1 blocker — driven by prop, not stale brief
    expect(screen.getByText(/1 blocker$/i)).toBeInTheDocument();
  });

  it("shows overlay spinner during regeneration (AC-S3/GAP-6/REQ-48)", () => {
    // Brief is loaded, but mutation is pending (regenerating)
    vi.mocked(riskBriefHooks.useRiskBrief).mockReturnValue({
      data: BRIEF_DATA,
      isLoading: false,
    } as never);
    vi.mocked(riskBriefHooks.useGenerateRiskBrief).mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    } as never);

    renderCard();

    // Overlay should be present with aria-label
    const overlay = screen.getByRole("status", { name: /regenerating brief/i });
    expect(overlay).toBeInTheDocument();

    // Brief content should still be visible under the overlay
    expect(screen.getByText("Adds rate limiting to the auth endpoint")).toBeInTheDocument();
  });

  it("Generate brief button is re-enabled after POST failure (EC-4/GAP-8)", () => {
    // First: locally pending (button disabled)
    vi.mocked(riskBriefHooks.useRiskBrief).mockReturnValue({
      data: null,
      isLoading: false,
    } as never);
    vi.mocked(riskBriefHooks.useGenerateRiskBrief).mockReturnValue({
      mutate: vi.fn(),
      isPending: false, // request settled (failed)
    } as never);

    renderCard();

    // Button should be enabled again
    const btn = screen.getByRole("button", { name: /generate risk brief/i });
    expect(btn).not.toBeDisabled();
  });

  it("Regenerate button is re-enabled after regeneration failure (EC-5/GAP-8)", () => {
    vi.mocked(riskBriefHooks.useRiskBrief).mockReturnValue({
      data: BRIEF_DATA,
      isLoading: false,
    } as never);
    vi.mocked(riskBriefHooks.useGenerateRiskBrief).mockReturnValue({
      mutate: vi.fn(),
      isPending: false, // request settled (failed)
    } as never);

    renderCard();

    const btn = screen.getByRole("button", { name: /regenerate risk brief/i });
    expect(btn).not.toBeDisabled();
  });

  it("clicking Generate brief calls mutation.mutate (AC-E1)", () => {
    const mutateFn = vi.fn();
    vi.mocked(riskBriefHooks.useRiskBrief).mockReturnValue({
      data: null,
      isLoading: false,
    } as never);
    vi.mocked(riskBriefHooks.useGenerateRiskBrief).mockReturnValue({
      mutate: mutateFn,
      isPending: false,
    } as never);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /generate risk brief/i }));
    expect(mutateFn).toHaveBeenCalledOnce();
  });
});
