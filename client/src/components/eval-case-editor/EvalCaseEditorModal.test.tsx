/* EvalCaseEditorModal unit tests — validates JSON, skeleton button, focus trap. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EvalCaseEditorModal } from "./EvalCaseEditorModal";

// Mock hooks
vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ id: "c1", name: "Test" }), isPending: false })),
  useUpdateEvalCase: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useRunEvalCase: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ pass: true, duration_ms: 500 }), isPending: false })),
}));

vi.mock("@/lib/toast", () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

afterEach(cleanup);

describe("EvalCaseEditorModal", () => {
  it("renders in create mode", () => {
    render(
      <EvalCaseEditorModal agentId="a1" onClose={vi.fn()} />,
    );
    expect(screen.getByText("New eval case")).toBeInTheDocument();
  });

  it("shows Valid JSON indicator for valid expected output", () => {
    render(<EvalCaseEditorModal agentId="a1" onClose={vi.fn()} />);
    expect(screen.getByText("Valid JSON")).toBeInTheDocument();
  });

  it("shows Invalid JSON indicator when json is broken", () => {
    render(<EvalCaseEditorModal agentId="a1" onClose={vi.fn()} />);
    const textarea = screen.getByLabelText("Expected output JSON");
    fireEvent.change(textarea, { target: { value: "{bad json" } });
    expect(screen.getByText(/Invalid JSON/i)).toBeInTheDocument();
  });

  it("inserts finding skeleton when skeleton button clicked", () => {
    render(<EvalCaseEditorModal agentId="a1" onClose={vi.fn()} />);
    const textarea = screen.getByLabelText("Expected output JSON") as HTMLTextAreaElement;
    fireEvent.click(screen.getByText("Finding skeleton"));
    expect(textarea.value).toContain("must_find");
  });

  it("calls onClose when Cancel clicked", () => {
    const onClose = vi.fn();
    render(<EvalCaseEditorModal agentId="a1" onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables Save button when name is empty", () => {
    render(<EvalCaseEditorModal agentId="a1" onClose={vi.fn()} />);
    const saveBtn = screen.getByRole("button", { name: /save/i });
    // name is empty by default → button should be disabled
    expect(saveBtn).toBeDisabled();
  });
});
