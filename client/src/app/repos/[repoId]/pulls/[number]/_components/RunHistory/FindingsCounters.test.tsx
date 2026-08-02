/**
 * FindingsCounters — severity badge rendering on RunHistory timeline rows.
 * Tests that severity counters appear for settled runs with findings,
 * and are hidden for running/failed/empty runs.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummaryCost, ReviewRecord, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummaryCost>): RunSummaryCost {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function finding(severity: string, overrides?: Partial<FindingRecord>): FindingRecord {
  return {
    id: `f-${severity.toLowerCase()}`,
    review_id: "r1",
    severity: severity as FindingRecord["severity"],
    category: "bug",
    title: `${severity} finding`,
    file: "src/index.ts",
    start_line: 1,
    end_line: 5,
    rationale: "Some rationale",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function review(runId: string, findings: FindingRecord[]): ReviewRecord {
  return {
    id: "review-1",
    pr_id: "pr-1",
    agent_id: "agent-1",
    run_id: runId,
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "comment",
    summary: null,
    score: 50,
    model: "gpt-4",
    grounding: null,
    created_at: "2026-01-01T00:00:00Z",
    findings,
  };
}

function renderWithReviews(runs: RunSummaryCost[], reviews: ReviewRecord[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} reviews={reviews} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — severity counters", () => {
  it("renders severity badges for a settled run with mixed findings", () => {
    const findings = [
      finding("CRITICAL"),
      finding("CRITICAL"),
      finding("WARNING"),
    ];
    renderWithReviews(
      [run({ run_id: "run-1", findings_count: 3, blockers: 2 })],
      [review("run-1", findings)],
    );
    // SeverityBadge compact renders the count as text
    expect(screen.getByText("2")).toBeInTheDocument(); // CRITICAL count
    expect(screen.getByText("1")).toBeInTheDocument(); // WARNING count
  });

  it("renders no badges for a settled run with 0 findings", () => {
    renderWithReviews(
      [run({ run_id: "run-1", findings_count: 0, blockers: 0, score: 95 })],
      [review("run-1", [])],
    );
    // No severity badge counts should be present
    expect(screen.queryByText("CRITICAL")).not.toBeInTheDocument();
  });

  it("renders no badges for a running run", () => {
    renderWithReviews(
      [run({ run_id: "run-1", status: "running", score: null })],
      [review("run-1", [finding("CRITICAL")])],
    );
    expect(screen.getByText("running")).toBeInTheDocument();
    // No severity count badge
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("renders no badges for a failed run", () => {
    renderWithReviews(
      [run({ run_id: "run-1", status: "failed", error: "boom", score: null })],
      [review("run-1", [finding("CRITICAL")])],
    );
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("falls back to text display when reviews prop is not provided", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunHistory
          runs={[run({ findings_count: 3, blockers: 2 })]}
          onOpenTrace={() => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/3 finding/)).toBeInTheDocument();
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
  });
});
