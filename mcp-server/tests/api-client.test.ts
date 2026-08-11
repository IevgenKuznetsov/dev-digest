import { describe, it, expect, vi, beforeEach } from "vitest";
import { DevDigestClient } from "../src/api-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockOk(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response);
}

function mockError(status: number, text: string) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: text,
    text: () => Promise.resolve(text),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DevDigestClient", () => {
  const client = new DevDigestClient("http://localhost:3001");

  describe("listAgents", () => {
    it("calls GET /agents", async () => {
      const agents = [{ id: "1", name: "gpt-4o" }];
      mockFetch.mockReturnValueOnce(mockOk(agents));

      const result = await client.listAgents();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/agents",
        expect.objectContaining({ method: "GET" })
      );
      expect(result).toEqual(agents);
    });
  });

  describe("runReview", () => {
    it("calls POST /pulls/:id/review with agentId body", async () => {
      mockFetch.mockReturnValueOnce(mockOk({ run_id: "r1" }));

      await client.runReview("42", "agent-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/pulls/42/review",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ agentId: "agent-1" }),
        })
      );
    });
  });

  describe("getActiveRuns", () => {
    it("calls GET /pulls/:id/runs/active", async () => {
      mockFetch.mockReturnValueOnce(mockOk([]));

      await client.getActiveRuns("42");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/pulls/42/runs/active",
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  describe("getReviews", () => {
    it("calls GET /pulls/:id/reviews", async () => {
      mockFetch.mockReturnValueOnce(mockOk([]));

      await client.getReviews("42");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/pulls/42/reviews",
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  describe("getConventions", () => {
    it("calls GET /repos/:id/conventions", async () => {
      mockFetch.mockReturnValueOnce(mockOk([]));

      await client.getConventions("repo-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/repos/repo-1/conventions",
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  describe("getBlastRadius", () => {
    it("returns placeholder without calling fetch", async () => {
      const result = await client.getBlastRadius("42");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual({ error: "not implemented" });
    });
  });

  describe("error handling", () => {
    it("throws on non-ok response", async () => {
      mockFetch.mockReturnValueOnce(mockError(404, "Not Found"));

      await expect(client.listAgents()).rejects.toThrow("HTTP 404: Not Found");
    });

    it("uses custom baseUrl", async () => {
      const customClient = new DevDigestClient("http://custom:9000");
      mockFetch.mockReturnValueOnce(mockOk([]));

      await customClient.listAgents();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://custom:9000/agents",
        expect.anything()
      );
    });

    it("strips trailing slash from baseUrl", async () => {
      const customClient = new DevDigestClient("http://localhost:3001/");
      mockFetch.mockReturnValueOnce(mockOk([]));

      await customClient.listAgents();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/agents",
        expect.anything()
      );
    });

    it("passes extra headers", async () => {
      const authedClient = new DevDigestClient("http://localhost:3001", {
        Authorization: "Bearer token",
      });
      mockFetch.mockReturnValueOnce(mockOk([]));

      await authedClient.listAgents();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer token",
          }),
        })
      );
    });
  });
});
