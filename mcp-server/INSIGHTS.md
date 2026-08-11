# mcp-server INSIGHTS

Non-obvious discoveries captured during development. Append-only. See skill `engineering-insight` for format rules.

Last updated: 2026-08-11

---

- `2026-08-11` **Tool & Library Notes:** `McpServer.tool()` 5-arg overload (name, description, paramsSchema, annotations, cb) expects **raw Zod shape** `{ pr_id: z.string() }` not `z.object({ pr_id: z.string() })` — `ZodRawShapeCompat = Record<string, AnySchema>`, passing a `ZodObject` still compiles but mismatches the overload — `src/tools.ts`, `node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.d.ts`
- `2026-08-11` **Recurring Errors & Fixes:** Vitest fake-timer test for a polling timeout throws "Promise rejection was handled asynchronously" if you `advanceTimersByTimeAsync` before attaching `.rejects` — attach the `expect(promise).rejects` handler first, then advance timers — `tests/poll.test.ts`
