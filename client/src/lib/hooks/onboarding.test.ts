/**
 * Unit tests for useOnboarding hook.
 * Tests the 404-to-null conversion and response pass-through without a real API.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { ApiError } from "../api";

// Mock the api module before imports that use it.
vi.mock("../api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../api")>();
  return {
    ...mod,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
    },
  };
});

import { api } from "../api";
import { useOnboarding } from "./onboarding";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

const ONBOARDING_RESPONSE = {
  sections: [
    {
      kind: "architecture" as const,
      title: "Architecture Overview",
      body: "A description.",
      diagram: "flowchart LR\n  A --> B",
      links: [],
    },
  ],
  model: "deepseek/deepseek-v4-flash",
  generated_at: "2026-01-01T00:00:00.000Z",
  input_sha: "abc123",
};

const GENERATING_RESPONSE = { status: "generating" as const };

describe("useOnboarding", () => {
  it("returns null when API returns 404 (empty state, no error)", async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError("Not found", 404, "not_found"));

    const { result } = renderHook(() => useOnboarding("repo-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it("returns OnboardingResponse when API returns 200 with tour data", async () => {
    vi.mocked(api.get).mockResolvedValue(ONBOARDING_RESPONSE);

    const { result } = renderHook(() => useOnboarding("repo-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(ONBOARDING_RESPONSE);
  });

  it("returns generating status when API returns { status: 'generating' }", async () => {
    vi.mocked(api.get).mockResolvedValue(GENERATING_RESPONSE);

    const { result } = renderHook(() => useOnboarding("repo-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ status: "generating" });
  });

  it("is disabled when repoId is null", () => {
    const { result } = renderHook(() => useOnboarding(null), {
      wrapper: makeWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(api.get).not.toHaveBeenCalled();
  });

  it("propagates non-404 API errors as error state", async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError("Server error", 500, "internal_error"));

    const { result } = renderHook(() => useOnboarding("repo-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });
});
