import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerTools } from "../src/tools.js";
import type { DevDigestClient } from "../src/api-client.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Capture registered tool handlers by name
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function makeServer() {
  const handlers: Record<string, ToolHandler> = {};
  const server = {
    tool: vi.fn(
      (
        name: string,
        _description: string,
        _schema: unknown,
        _annotations: unknown,
        handler: ToolHandler
      ) => {
        handlers[name] = handler;
      }
    ),
  } as unknown as McpServer;
  return { server, handlers };
}

function makeClient(overrides: Partial<DevDigestClient> = {}): DevDigestClient {
  return {
    listAgents: vi.fn().mockResolvedValue([]),
    runReview: vi.fn().mockResolvedValue({ run_id: "r1" }),
    getActiveRuns: vi.fn().mockResolvedValue([]),
    getReviews: vi.fn().mockResolvedValue([]),
    getConventions: vi.fn().mockResolvedValue([]),
    getBlastRadius: vi.fn().mockResolvedValue({ error: "not implemented" }),
    ...overrides,
  } as unknown as DevDigestClient;
}

describe("registerTools", () => {
  it("registers exactly 5 tools in order", () => {
    const { server } = makeServer();
    const client = makeClient();
    registerTools(server, client);

    const calls = (server.tool as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(5);
    expect(calls.map((c: unknown[]) => c[0])).toEqual([
      "list_agents",
      "run_agent_on_pr",
      "get_findings",
      "get_conventions",
      "get_blast_radius",
    ]);
  });

  describe("list_agents", () => {
    it("returns only enabled agents with projected fields", async () => {
      const { server, handlers } = makeServer();
      const agents = [
        { id: "1", name: "gpt-4o", model: "gpt-4o", description: "Main", provider: "openai", enabled: true },
        { id: "2", name: "disabled", model: "gpt-3.5", description: "Off", provider: "openai", enabled: false },
      ];
      const client = makeClient({
        listAgents: vi.fn().mockResolvedValue(agents),
      });
      registerTools(server, client);

      const result = (await handlers["list_agents"]({})) as {
        content: Array<{ type: string; text: string }>;
      };

      expect(result.content[0].type).toBe("text");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual([
        { id: "1", name: "gpt-4o", model: "gpt-4o", description: "Main" },
      ]);
    });

    it("returns isError on client failure", async () => {
      const { server, handlers } = makeServer();
      const client = makeClient({
        listAgents: vi.fn().mockRejectedValue(new Error("Network error")),
      });
      registerTools(server, client);

      const result = (await handlers["list_agents"]({})) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Network error");
    });
  });

  describe("get_findings", () => {
    it("truncates to top 20 findings sorted by severity", async () => {
      const { server, handlers } = makeServer();

      const makeFinding = (id: string, severity: string) => ({
        id,
        severity,
        category: "test",
        title: `Finding ${id}`,
        file: "test.ts",
        start_line: 1,
        end_line: 1,
        rationale: "test",
      });

      // 25 findings with mixed severity
      const findings = [
        ...Array.from({ length: 10 }, (_, i) =>
          makeFinding(`info-${i}`, "info")
        ),
        ...Array.from({ length: 10 }, (_, i) =>
          makeFinding(`warning-${i}`, "warning")
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeFinding(`critical-${i}`, "critical")
        ),
      ];

      const client = makeClient({
        getReviews: vi.fn().mockResolvedValue([
          { id: "rev1", agent_name: "gpt-4o", findings },
        ]),
      });
      registerTools(server, client);

      const result = (await handlers["get_findings"]({ pr_id: "42" })) as {
        content: Array<{ text: string }>;
      };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(20);
      // First entries should be critical (highest priority)
      expect(parsed[0].severity).toBe("critical");
      expect(parsed[4].severity).toBe("critical");
      expect(parsed[5].severity).toBe("warning");
    });

    it("returns isError when getReviews fails", async () => {
      const { server, handlers } = makeServer();
      const client = makeClient({
        getReviews: vi.fn().mockRejectedValue(new Error("Fetch failed")),
      });
      registerTools(server, client);

      const result = (await handlers["get_findings"]({ pr_id: "42" })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Fetch failed");
    });
  });

  describe("get_conventions", () => {
    it("calls getConventions with repo_id", async () => {
      const { server, handlers } = makeServer();
      const conventions = [{ id: "c1", rule: "no-any" }];
      const getConventions = vi.fn().mockResolvedValue(conventions);
      const client = makeClient({ getConventions });
      registerTools(server, client);

      const result = (await handlers["get_conventions"]({
        repo_id: "repo-1",
      })) as { content: Array<{ text: string }> };

      expect(getConventions).toHaveBeenCalledWith("repo-1");
      expect(JSON.parse(result.content[0].text)).toEqual(conventions);
    });
  });

  describe("get_blast_radius", () => {
    it("returns placeholder message without calling client", async () => {
      const { server, handlers } = makeServer();
      const getBlastRadius = vi.fn();
      const client = makeClient({ getBlastRadius });
      registerTools(server, client);

      const result = (await handlers["get_blast_radius"]({
        pr_id: "42",
      })) as { content: Array<{ text: string }> };

      expect(getBlastRadius).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain("not yet available");
    });
  });

  describe("run_agent_on_pr", () => {
    it("returns isError when runReview fails", async () => {
      const { server, handlers } = makeServer();
      const client = makeClient({
        runReview: vi.fn().mockRejectedValue(new Error("Server error")),
      });
      registerTools(server, client);

      const result = (await handlers["run_agent_on_pr"]({
        pr_id: "42",
        agent_id: "agent-1",
      })) as { isError: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Server error");
    });

    it("polls active runs and returns reviews when done", async () => {
      const { server, handlers } = makeServer();

      let pollCalls = 0;
      const reviews = [{ id: "rev1", verdict: "approved", score: 90 }];

      const client = makeClient({
        runReview: vi.fn().mockResolvedValue({ run_id: "r1" }),
        getActiveRuns: vi.fn().mockImplementation(async () => {
          pollCalls++;
          // Return empty on 2nd call (done)
          if (pollCalls >= 2) return [];
          return [{ run_id: "r1", status: "running" }];
        }),
        getReviews: vi.fn().mockResolvedValue(reviews),
      });
      registerTools(server, client);

      const result = (await handlers["run_agent_on_pr"]({
        pr_id: "42",
        agent_id: "agent-1",
      })) as { content: Array<{ text: string }> };

      expect(JSON.parse(result.content[0].text)).toEqual(reviews);
      expect(pollCalls).toBeGreaterThanOrEqual(2);
    });
  });
});
