/* ConflictsSection — unit tests.
   Focus: "Show only conflicts" toggle filtering, empty state, and rendering. */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ConflictsSection } from "./ConflictsSection";
import type { Conflict } from "@devdigest/shared";

afterEach(cleanup);

// ---- Fixtures ----

const CONFLICT_MIXED: Conflict = {
  file: "src/auth.ts",
  line: 42,
  title: "SQL injection risk",
  takes: [
    { agent_id: "a1", persona: "Security Agent", verdict: "CRITICAL", note: "Use parameterized queries" },
    { agent_id: "a2", persona: "Perf Agent", verdict: "WARNING", note: "Consider caching" },
  ],
};

/** A conflict where all takes share the same verdict — counts as "unanimous" */
const CONFLICT_UNANIMOUS: Conflict = {
  file: "src/utils.ts",
  line: 10,
  title: "Missing null check",
  takes: [
    { agent_id: "a1", persona: "Security Agent", verdict: "WARNING", note: "" },
    { agent_id: "a2", persona: "Perf Agent", verdict: "WARNING", note: "" },
  ],
};

const CONFLICT_IGNORED: Conflict = {
  file: "src/db.ts",
  line: 5,
  title: "Unoptimized query",
  takes: [
    { agent_id: "a1", persona: "Security Agent", verdict: "SUGGESTION", note: "" },
    { agent_id: "a2", persona: "Perf Agent", verdict: "ignored", note: "" },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConflictsSection — empty state", () => {
  it("shows empty message when conflicts array is empty", () => {
    render(<ConflictsSection conflicts={[]} />);
    expect(screen.getByText(/no disagreements found/i)).toBeInTheDocument();
  });
});

describe("ConflictsSection — renders conflict cards", () => {
  it("renders file location, title, and agent takes for each conflict", () => {
    render(<ConflictsSection conflicts={[CONFLICT_MIXED]} />);

    // File:line location
    expect(screen.getByText("src/auth.ts:42")).toBeInTheDocument();
    // Title
    expect(screen.getByText("SQL injection risk")).toBeInTheDocument();
    // Agent takes: both verdicts should appear
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText("WARNING")).toBeInTheDocument();
    // Agent persona names
    expect(screen.getByText("Security Agent")).toBeInTheDocument();
    expect(screen.getByText("Perf Agent")).toBeInTheDocument();
  });

  it("renders the 'Where Agents Disagree' heading", () => {
    render(<ConflictsSection conflicts={[CONFLICT_MIXED]} />);
    expect(screen.getByRole("heading", { name: /where agents disagree/i })).toBeInTheDocument();
  });
});

describe("ConflictsSection — 'Show only conflicts' toggle", () => {
  it("toggle checkbox is present and accessible", () => {
    render(<ConflictsSection conflicts={[CONFLICT_MIXED, CONFLICT_UNANIMOUS]} />);
    const toggle = screen.getByRole("checkbox", { name: /show only conflicts/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  it("shows all conflicts when toggle is off", () => {
    render(<ConflictsSection conflicts={[CONFLICT_MIXED, CONFLICT_UNANIMOUS]} />);
    // Both conflicts visible
    expect(screen.getByText("src/auth.ts:42")).toBeInTheDocument();
    expect(screen.getByText("src/utils.ts:10")).toBeInTheDocument();
  });

  it("hides unanimous groups when toggle is on", () => {
    render(<ConflictsSection conflicts={[CONFLICT_MIXED, CONFLICT_UNANIMOUS]} />);

    const toggle = screen.getByRole("checkbox", { name: /show only conflicts/i });
    fireEvent.click(toggle);

    // Unanimous conflict (WARNING + WARNING) should be hidden
    expect(screen.queryByText("src/utils.ts:10")).not.toBeInTheDocument();
    // Mixed conflict (CRITICAL + WARNING) should remain
    expect(screen.getByText("src/auth.ts:42")).toBeInTheDocument();
  });

  it("shows 'No strict conflicts' message when toggle hides everything", () => {
    // Only a unanimous conflict
    render(<ConflictsSection conflicts={[CONFLICT_UNANIMOUS]} />);

    const toggle = screen.getByRole("checkbox", { name: /show only conflicts/i });
    fireEvent.click(toggle);

    expect(screen.getByText(/no strict conflicts found/i)).toBeInTheDocument();
    expect(screen.queryByText("src/utils.ts:10")).not.toBeInTheDocument();
  });

  it("keeps 'ignored' takes visible — an ignored agent is always a conflict", () => {
    // CONFLICT_IGNORED has SUGGESTION + ignored → mixed verdicts → should survive the filter
    render(<ConflictsSection conflicts={[CONFLICT_IGNORED]} />);

    const toggle = screen.getByRole("checkbox", { name: /show only conflicts/i });
    fireEvent.click(toggle);

    expect(screen.getByText("src/db.ts:5")).toBeInTheDocument();
    expect(screen.getByText("ignored")).toBeInTheDocument();
  });
});
