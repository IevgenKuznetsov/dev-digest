import { describe, it, expect } from "vitest";
import type { ReviewRecord, FindingRecord } from "@devdigest/shared";
import { findingsForRun } from "./severity-counts";

function finding(severity: string, overrides?: Partial<FindingRecord>): FindingRecord {
  return {
    id: `f-${Math.random().toString(36).slice(2, 8)}`,
    review_id: "r1",
    severity: severity as FindingRecord["severity"],
    category: "bug",
    title: "Test finding",
    file: "src/index.ts",
    start_line: 1,
    end_line: 5,
    rationale: "Some rationale text",
    suggestion: null,
    confidence: 0.95,
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

describe("findingsForRun", () => {
  it("groups findings by severity for a matching run", () => {
    const findings = [
      finding("CRITICAL"),
      finding("CRITICAL"),
      finding("WARNING"),
      finding("SUGGESTION"),
      finding("SUGGESTION"),
      finding("SUGGESTION"),
    ];
    const reviews = [review("run-1", findings)];
    const result = findingsForRun("run-1", reviews);
    expect(result.CRITICAL).toHaveLength(2);
    expect(result.WARNING).toHaveLength(1);
    expect(result.SUGGESTION).toHaveLength(3);
  });

  it("returns empty arrays when no review matches the run", () => {
    const reviews = [review("run-other", [finding("CRITICAL")])];
    const result = findingsForRun("run-1", reviews);
    expect(result.CRITICAL).toHaveLength(0);
    expect(result.WARNING).toHaveLength(0);
    expect(result.SUGGESTION).toHaveLength(0);
  });

  it("aggregates findings from multiple reviews for the same run", () => {
    const r1 = review("run-1", [finding("CRITICAL")]);
    const r2 = { ...review("run-1", [finding("WARNING"), finding("WARNING")]), id: "review-2" };
    const result = findingsForRun("run-1", [r1, r2]);
    expect(result.CRITICAL).toHaveLength(1);
    expect(result.WARNING).toHaveLength(2);
  });

  it("returns empty arrays for an empty reviews list", () => {
    const result = findingsForRun("run-1", []);
    expect(result.CRITICAL).toHaveLength(0);
    expect(result.WARNING).toHaveLength(0);
    expect(result.SUGGESTION).toHaveLength(0);
  });

  it("includes accepted and dismissed findings in counts", () => {
    const findings = [
      finding("CRITICAL", { accepted_at: "2026-01-01T00:00:00Z" }),
      finding("CRITICAL", { dismissed_at: "2026-01-01T00:00:00Z" }),
      finding("CRITICAL"),
    ];
    const reviews = [review("run-1", findings)];
    const result = findingsForRun("run-1", reviews);
    expect(result.CRITICAL).toHaveLength(3);
  });
});
