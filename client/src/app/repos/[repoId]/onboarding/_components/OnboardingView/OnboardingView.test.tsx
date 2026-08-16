/**
 * Component tests for OnboardingView.
 * All hooks are mocked — no API calls.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock hooks before importing the component.
vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboarding: vi.fn(),
  useGenerateOnboarding: vi.fn(),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: vi.fn(),
  useRepoNotFound: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  useToast: vi.fn(),
}));

// MermaidDiagram is async and irrelevant for these unit tests — replace with a stub.
vi.mock("@/components/mermaid-diagram", () => ({
  MermaidDiagram: ({ chart }: { chart: string }) => (
    <div data-testid="mermaid-diagram">{chart}</div>
  ),
}));

import * as onboardingHooks from "@/lib/hooks/onboarding";
import * as repoContext from "@/lib/repo-context";
import * as toastModule from "@/lib/toast";
import { OnboardingView } from "./OnboardingView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---- Fixtures ----

const ACTIVE_REPO = {
  id: "repo-1",
  owner: "acme",
  name: "widget",
  full_name: "acme/widget",
  default_branch: "main",
};

const SECTIONS = [
  { kind: "architecture", title: "Arch", body: "Arch body", diagram: "flowchart LR\n  A --> B", links: [] },
  { kind: "critical_paths", title: "Paths", body: "Paths body", diagram: null, links: [{ label: "index.ts", path: "src/index.ts" }] },
  { kind: "run_locally", title: "Run", body: "```sh\nnpm install\n```", diagram: null, links: [] },
  { kind: "reading_path", title: "Read", body: "Read body", diagram: null, links: [] },
  { kind: "first_tasks", title: "Tasks", body: "Tasks body", diagram: null, links: [] },
];

const TOUR_DATA = {
  sections: SECTIONS,
  model: "deepseek/deepseek-v4-flash",
  generated_at: "2026-01-01T00:00:00.000Z",
  input_sha: "abc123",
};

function setupHooks({
  queryData = null as typeof TOUR_DATA | { status: "generating" } | null,
  queryLoading = false,
  mutationPending = false,
}: {
  queryData?: typeof TOUR_DATA | { status: "generating" } | null;
  queryLoading?: boolean;
  mutationPending?: boolean;
} = {}) {
  vi.mocked(onboardingHooks.useOnboarding).mockReturnValue({
    data: queryData,
    isLoading: queryLoading,
    isError: false,
    isSuccess: !queryLoading,
  } as ReturnType<typeof onboardingHooks.useOnboarding>);

  vi.mocked(onboardingHooks.useGenerateOnboarding).mockReturnValue({
    mutate: vi.fn(),
    isPending: mutationPending,
    isError: false,
  } as unknown as ReturnType<typeof onboardingHooks.useGenerateOnboarding>);

  vi.mocked(repoContext.useActiveRepo).mockReturnValue({
    activeRepo: ACTIVE_REPO,
    repoId: "repo-1",
    setRepoId: vi.fn(),
    repos: [ACTIVE_REPO],
    reposLoaded: true,
  } as unknown as ReturnType<typeof repoContext.useActiveRepo>);

  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() };
  vi.mocked(toastModule.useToast).mockReturnValue(toast);

  return { toast };
}

function renderView(repoId = "repo-1") {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <OnboardingView repoId={repoId} />
    </QueryClientProvider>,
  );
}

// ---- Tests ----

describe("OnboardingView", () => {
  it("renders empty state when no onboarding tour exists", () => {
    setupHooks({ queryData: null });
    renderView();

    // The EmptyState shows the title text and a CTA button.
    expect(screen.getAllByText("Generate onboarding tour").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /generate onboarding tour/i })).toBeInTheDocument();
  });

  it("renders tour sections after generation", () => {
    setupHooks({ queryData: TOUR_DATA });
    renderView();

    // Header should appear.
    expect(screen.getByText("Onboarding Tour")).toBeInTheDocument();

    // All 5 section headings should appear using SECTION_TITLES display names.
    expect(screen.getByText("Architecture Overview")).toBeInTheDocument();
    expect(screen.getByText("Critical Paths")).toBeInTheDocument();
    expect(screen.getByText("How to Run Locally")).toBeInTheDocument();
    expect(screen.getByText("Guided Reading Path")).toBeInTheDocument();
    expect(screen.getByText("First Tasks")).toBeInTheDocument();

    // Regenerate button should appear.
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
  });

  it("displays generating spinner when mutation is pending", () => {
    setupHooks({ queryData: null, mutationPending: true });
    renderView();

    expect(screen.getByText("Generating…")).toBeInTheDocument();
    expect(screen.queryByText("Architecture Overview")).not.toBeInTheDocument();
  });

  it("hides old tour content when mutation is pending (edge case 9: regeneration)", () => {
    // Existing tour data + pending mutation = regeneration in progress.
    setupHooks({ queryData: TOUR_DATA, mutationPending: true });
    renderView();

    // Spinner should show.
    expect(screen.getByText("Generating…")).toBeInTheDocument();

    // Old section headings must NOT be visible.
    expect(screen.queryByText("Architecture Overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Critical Paths")).not.toBeInTheDocument();
  });

  it("shows generating spinner when query returns { status: 'generating' }", () => {
    setupHooks({ queryData: { status: "generating" } });
    renderView();

    expect(screen.getByText("Generating…")).toBeInTheDocument();
    expect(screen.queryByText("Onboarding Tour")).not.toBeInTheDocument();
  });

  it("renders Open-on-GitHub links using defaultBranch from useActiveRepo (edge case 8)", () => {
    setupHooks({ queryData: TOUR_DATA });
    renderView();

    // critical_paths section has a link with path "src/index.ts".
    // The Open button should exist as a link with the correct GitHub URL.
    const openLinks = screen.getAllByRole("link", { name: /open/i });
    expect(openLinks.length).toBeGreaterThan(0);
    expect(openLinks[0]).toHaveAttribute(
      "href",
      "https://github.com/acme/widget/blob/main/src/index.ts",
    );
  });

  it("clicking copy button on a run_locally code block calls clipboard.writeText with the code content", async () => {
    // Set up clipboard mock.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    setupHooks({ queryData: TOUR_DATA });
    renderView();

    // The run_locally section body has "```sh\nnpm install\n```".
    // The copy button has aria-label "Copy code to clipboard".
    const copyButtons = screen.getAllByLabelText("Copy code to clipboard");
    expect(copyButtons.length).toBeGreaterThan(0);

    fireEvent.click(copyButtons[0]!);

    expect(writeText).toHaveBeenCalledWith("npm install\n");
  });

  it("calls generate mutation on CTA click", () => {
    const mockMutate = vi.fn();
    vi.mocked(onboardingHooks.useGenerateOnboarding).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof onboardingHooks.useGenerateOnboarding>);

    vi.mocked(onboardingHooks.useOnboarding).mockReturnValue({
      data: null,
      isLoading: false,
    } as ReturnType<typeof onboardingHooks.useOnboarding>);

    vi.mocked(repoContext.useActiveRepo).mockReturnValue({
      activeRepo: ACTIVE_REPO,
    } as unknown as ReturnType<typeof repoContext.useActiveRepo>);

    vi.mocked(toastModule.useToast).mockReturnValue({
      success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn(),
    });

    renderView();

    const cta = screen.getByRole("button", { name: /generate onboarding tour/i });
    fireEvent.click(cta);

    expect(mockMutate).toHaveBeenCalledWith({ repoId: "repo-1" });
  });
});
