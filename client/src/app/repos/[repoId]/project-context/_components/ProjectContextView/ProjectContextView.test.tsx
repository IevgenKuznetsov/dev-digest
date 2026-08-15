import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock all project-context hooks — the component renders without a real API.
vi.mock("@/lib/hooks/project-context", () => ({
  useContextDocs: vi.fn(),
  useContextDocContent: vi.fn(),
  useScanContextDocs: vi.fn(),
  useUpdateContextDocContent: vi.fn(),
  useCreateContextDoc: vi.fn(),
  useDeleteContextDoc: vi.fn(),
  useUploadContextDoc: vi.fn(),
  useCreateContextFolder: vi.fn(),
}));

import * as hooks from "@/lib/hooks/project-context";
import { ProjectContextView } from "./ProjectContextView";

afterEach(cleanup);

// ---- Sample data ----

const DOCS = [
  {
    id: "doc-1",
    repoId: "repo-1",
    workspaceId: "ws-1",
    path: "specs/security-baseline.md",
    category: "specs" as const,
    tokens: 120,
    scannedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: "doc-2",
    repoId: "repo-1",
    workspaceId: "ws-1",
    path: "docs/architecture.md",
    category: "docs" as const,
    tokens: 80,
    scannedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
];

function setupHooks(docs = DOCS, isLoading = false) {
  vi.mocked(hooks.useContextDocs).mockReturnValue({
    data: docs,
    isLoading,
  } as ReturnType<typeof hooks.useContextDocs>);

  vi.mocked(hooks.useContextDocContent).mockReturnValue({
    data: "# Security baseline\nSSRF validation required.",
    isLoading: false,
  } as ReturnType<typeof hooks.useContextDocContent>);

  vi.mocked(hooks.useScanContextDocs).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useScanContextDocs>);

  vi.mocked(hooks.useUpdateContextDocContent).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useUpdateContextDocContent>);

  vi.mocked(hooks.useCreateContextDoc).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useCreateContextDoc>);

  vi.mocked(hooks.useDeleteContextDoc).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useDeleteContextDoc>);

  vi.mocked(hooks.useUploadContextDoc).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useUploadContextDoc>);

  vi.mocked(hooks.useCreateContextFolder).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useCreateContextFolder>);
}

function renderView(repoId = "repo-1") {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ProjectContextView repoId={repoId} />
    </QueryClientProvider>,
  );
}

// ====================================================== Tests

describe("ProjectContextView", () => {
  it("renders file list from mock data", () => {
    setupHooks(DOCS);
    renderView();

    // Shows filenames derived from the path (last segment).
    expect(screen.getByText("security-baseline.md")).toBeInTheDocument();
    expect(screen.getByText("architecture.md")).toBeInTheDocument();

    // Shows category labels.
    expect(screen.getByText("specs")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();

    // Shows indexed count in footer.
    expect(screen.getByText(/Indexed: 2 files/)).toBeInTheDocument();
  });

  it("shows empty state with call-to-action when no docs exist", () => {
    setupHooks([], false);
    renderView();

    expect(screen.getByText("No spec files yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add a spec file/i })).toBeInTheDocument();
  });

  it("passes search value to useContextDocs when user filters", () => {
    setupHooks(DOCS);
    renderView();

    const searchInput = screen.getByPlaceholderText("Filter files…");
    expect(searchInput).toBeInTheDocument();

    // Simulate typing in the search box.
    fireEvent.change(searchInput, { target: { value: "security" } });

    // useContextDocs is called with the search string on re-render.
    const calls = vi.mocked(hooks.useContextDocs).mock.calls;
    const lastSearch = calls[calls.length - 1]?.[1];
    expect(lastSearch).toBe("security");
  });
});
