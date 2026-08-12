import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DevDigestClient } from "./api-client.js";
import type { FindingRecord } from "./types.js";

// ZodRawShapeCompat: Record<string, ZodTypeAny> — raw shape, not z.object()

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
  suggestion: 4,
};

function severityRank(severity: string): number {
  return SEVERITY_ORDER[severity.toLowerCase()] ?? 99;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export function registerTools(
  server: McpServer,
  client: DevDigestClient
): void {
  server.tool(
    "list_agents",
    "List configured review agents",
    {},
    { readOnlyHint: true },
    async () => {
      try {
        const agents = await client.listAgents();
        const enabled = agents
          .filter((a) => a.enabled)
          .map(({ id, name, model, description }) => ({ id, name, model, description }));
        return textResult(JSON.stringify(enabled, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "run_agent_on_pr",
    "Run a review agent on a PR, returns when done",
    { pr_id: z.string(), agent_id: z.string() },
    { destructiveHint: false, idempotentHint: false },
    async ({ pr_id, agent_id }) => {
      try {
        await client.runReview(pr_id, agent_id);

        const { pollUntilDone } = await import("./poll.js");

        await pollUntilDone(
          async () => {
            const runs = await client.getActiveRuns(pr_id);
            const stillRunning = runs.some((r) => r.status === "running");
            return { done: !stillRunning };
          },
          3000,
          300_000
        );

        const reviews = await client.getReviews(pr_id);
        return textResult(JSON.stringify(reviews, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_findings",
    "Get findings from finished reviews for a PR",
    { pr_id: z.string() },
    { readOnlyHint: true },
    async ({ pr_id }) => {
      try {
        const reviews = await client.getReviews(pr_id);
        const allFindings: FindingRecord[] = reviews.flatMap(
          (r) => r.findings ?? []
        );
        const top20 = allFindings
          .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
          .slice(0, 20);
        return textResult(JSON.stringify(top20, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_conventions",
    "Get repository coding conventions",
    { repo_id: z.string() },
    { readOnlyHint: true },
    async ({ repo_id }) => {
      try {
        const conventions = await client.getConventions(repo_id);
        return textResult(JSON.stringify(conventions, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_blast_radius",
    "Get PR influence map (changed symbols and callers)",
    { pr_id: z.string() },
    { readOnlyHint: true },
    async ({ pr_id }) => {
      try {
        const result = await client.getBlastRadius(pr_id);

        const lines: string[] = [];

        if (result.degraded) {
          const note =
            result.reason === "no_files"
              ? "PR files not loaded yet — open the Files tab first"
              : "Index incomplete — results may be approximate";
          lines.push(`Note: ${note}`, "");
        }

        lines.push(`Changed Symbols (${result.changed_symbols.length}):`);
        if (result.changed_symbols.length === 0) {
          lines.push("  (none)");
        } else {
          for (const sym of result.changed_symbols) {
            lines.push(`  - ${sym.name} (${sym.kind}) in ${sym.file}`);
          }
        }

        lines.push("", `Callers (${result.callers.length}):`);
        if (result.callers.length === 0) {
          lines.push("  (none)");
        } else {
          // Group by via_symbol
          const grouped = new Map<string, typeof result.callers>();
          for (const caller of result.callers) {
            const group = grouped.get(caller.via_symbol) ?? [];
            group.push(caller);
            grouped.set(caller.via_symbol, group);
          }
          for (const [viaSymbol, callers] of grouped.entries()) {
            lines.push(`  Via ${viaSymbol}:`);
            for (const c of callers) {
              lines.push(`    - ${c.file}:${c.line}`);
            }
          }
        }

        lines.push(
          "",
          `Potentially Affected Endpoints (${result.impacted_endpoints.length}):`
        );
        if (result.impacted_endpoints.length === 0) {
          lines.push("  (none)");
        } else {
          for (const ep of result.impacted_endpoints) {
            lines.push(`  - ${ep}`);
          }
        }

        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}
