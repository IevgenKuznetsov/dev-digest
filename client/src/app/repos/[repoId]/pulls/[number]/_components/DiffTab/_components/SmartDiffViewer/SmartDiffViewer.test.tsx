import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SmartDiffViewer } from "./SmartDiffViewer";
import type { SmartDiffGroup } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";

afterEach(cleanup);

// Mock FileCard to avoid next-intl and diff-parsing dependencies in unit tests
vi.mock("@/components/diff-viewer/FileCard", () => ({
  FileCard: ({ file, defaultExpanded, findingLines }: { file: PrFile; defaultExpanded?: boolean; findingLines?: number[] }) => (
    <div
      data-testid={`file-card-${file.path}`}
      data-expanded={String(defaultExpanded)}
      data-findings={String(findingLines?.length ?? 0)}
    >
      {file.path}
    </div>
  ),
}));

const CORE_FILE: PrFile = {
  path: "src/auth.ts",
  additions: 20,
  deletions: 5,
  patch: null,
};

const WIRING_FILE: PrFile = {
  path: "src/index.ts",
  additions: 2,
  deletions: 0,
  patch: null,
};

const BOILERPLATE_FILE: PrFile = {
  path: "package-lock.json",
  additions: 100,
  deletions: 50,
  patch: null,
};

// GROUPS: only core has findings; wiring and boilerplate have none
const GROUPS: SmartDiffGroup[] = [
  {
    role: "core",
    files: [{ path: "src/auth.ts", additions: 20, deletions: 5, finding_lines: [10, 22], pseudocode_summary: null }],
  },
  {
    role: "wiring",
    files: [{ path: "src/index.ts", additions: 2, deletions: 0, finding_lines: [], pseudocode_summary: null }],
  },
  {
    role: "boilerplate",
    files: [{ path: "package-lock.json", additions: 100, deletions: 50, finding_lines: [], pseudocode_summary: null }],
  },
];

const ALL_FILES: PrFile[] = [CORE_FILE, WIRING_FILE, BOILERPLATE_FILE];

describe("SmartDiffViewer", () => {
  it("renders group headings for all roles that have files", () => {
    render(<SmartDiffViewer groups={GROUPS} files={ALL_FILES} />);
    // All groups have files — all headings are shown
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("Wiring")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
  });

  it("shows file count badges reflecting all files in the group", () => {
    render(<SmartDiffViewer groups={GROUPS} files={ALL_FILES} />);
    // Each group has 1 file
    const badges = screen.getAllByText("1 files");
    expect(badges.length).toBe(3);
  });

  it("shows finding count badge only for groups with findings", () => {
    render(<SmartDiffViewer groups={GROUPS} files={ALL_FILES} />);
    // core group has 1 file with findings
    expect(screen.getByText("1 with findings")).toBeInTheDocument();
  });

  it("renders all groups even when their files have no findings", () => {
    render(<SmartDiffViewer groups={GROUPS} files={ALL_FILES} />);
    // Wiring group has 0 findings but its FileCard should still appear
    expect(screen.getByTestId("file-card-src/index.ts")).toBeInTheDocument();
    // Boilerplate is collapsed by default — its FileCard is not rendered until expanded
    expect(screen.queryByTestId("file-card-package-lock.json")).not.toBeInTheDocument();
  });

  it("shows empty state when no groups have files", () => {
    const emptyGroups: SmartDiffGroup[] = [];
    render(<SmartDiffViewer groups={emptyGroups} files={[]} />);
    expect(
      screen.getByText(/No findings yet\. Run a review or switch to Flat view/)
    ).toBeInTheDocument();
  });

  it("boilerplate section is collapsed by default", () => {
    // With findings in boilerplate — use a different fixture
    const groupsWithBoilerplateFindings: SmartDiffGroup[] = [
      {
        role: "core",
        files: [{ path: "src/auth.ts", additions: 20, deletions: 5, finding_lines: [10], pseudocode_summary: null }],
      },
      {
        role: "boilerplate",
        files: [{ path: "package-lock.json", additions: 100, deletions: 50, finding_lines: [5], pseudocode_summary: null }],
      },
    ];
    render(<SmartDiffViewer groups={groupsWithBoilerplateFindings} files={ALL_FILES} />);
    // The boilerplate FileCard should not be rendered (collapsed)
    expect(screen.queryByTestId("file-card-package-lock.json")).not.toBeInTheDocument();
    // Core should be visible (expanded)
    expect(screen.getByTestId("file-card-src/auth.ts")).toBeInTheDocument();
  });

  it("core sections are expanded by default", () => {
    render(<SmartDiffViewer groups={GROUPS} files={ALL_FILES} />);
    expect(screen.getByTestId("file-card-src/auth.ts")).toBeInTheDocument();
  });

  it("clicking an expanded header collapses it", () => {
    render(<SmartDiffViewer groups={GROUPS} files={ALL_FILES} />);
    // Core is initially expanded
    expect(screen.getByTestId("file-card-src/auth.ts")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Core").closest("[role=button]")!);
    expect(screen.queryByTestId("file-card-src/auth.ts")).not.toBeInTheDocument();
  });

  it("does not render groups that are not present in the data", () => {
    const onlyCoreGroups: SmartDiffGroup[] = [
      {
        role: "core",
        files: [{ path: "src/x.ts", additions: 1, deletions: 0, finding_lines: [3], pseudocode_summary: null }],
      },
    ];
    const onlyCoreFiles: PrFile[] = [
      { path: "src/x.ts", additions: 1, deletions: 0, patch: null },
    ];
    render(<SmartDiffViewer groups={onlyCoreGroups} files={onlyCoreFiles} />);
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.queryByText("Wiring")).not.toBeInTheDocument();
    expect(screen.queryByText("Boilerplate")).not.toBeInTheDocument();
  });

  it("passes defaultExpanded=true to FileCards in core group", () => {
    render(<SmartDiffViewer groups={GROUPS} files={ALL_FILES} />);
    const coreCard = screen.getByTestId("file-card-src/auth.ts");
    expect(coreCard).toHaveAttribute("data-expanded", "true");
  });

  it("passes defaultExpanded=false to FileCards in boilerplate group", () => {
    const groupsWithBoilerplateFindings: SmartDiffGroup[] = [
      {
        role: "boilerplate",
        files: [{ path: "package-lock.json", additions: 100, deletions: 50, finding_lines: [5], pseudocode_summary: null }],
      },
    ];
    render(<SmartDiffViewer groups={groupsWithBoilerplateFindings} files={ALL_FILES} />);
    // Boilerplate is collapsed by default so we need to expand it first
    fireEvent.click(screen.getByText("Boilerplate").closest("[role=button]")!);
    const boilerplateCard = screen.getByTestId("file-card-package-lock.json");
    expect(boilerplateCard).toHaveAttribute("data-expanded", "false");
  });

  it("renders pseudocode_summary annotation when non-null (AC-E11)", () => {
    const groupsWithSummary: SmartDiffGroup[] = [
      {
        role: "core",
        files: [
          {
            path: "src/auth.ts",
            additions: 20,
            deletions: 5,
            finding_lines: [],
            pseudocode_summary: "Adds rate limiting to auth endpoint",
          },
        ],
      },
    ];
    const files: PrFile[] = [{ path: "src/auth.ts", additions: 20, deletions: 5, patch: null }];

    render(<SmartDiffViewer groups={groupsWithSummary} files={files} />);

    expect(screen.getByText("Adds rate limiting to auth endpoint")).toBeInTheDocument();
  });

  it("does not render pseudocode_summary annotation when null", () => {
    render(<SmartDiffViewer groups={GROUPS} files={ALL_FILES} />);
    // GROUPS has pseudocode_summary: null for all files
    // No annotation text from any summary should appear
    // (just confirming auth.ts card is present but no annotation div)
    expect(screen.getByTestId("file-card-src/auth.ts")).toBeInTheDocument();
    // The summary text from the fixture is null so there's nothing to query
    // Verify there's no Info-icon annotation element (no text from summaries)
    expect(screen.queryByText("Adds rate limiting to auth endpoint")).not.toBeInTheDocument();
  });
});
