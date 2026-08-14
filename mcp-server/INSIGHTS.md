# mcp-server INSIGHTS

Non-obvious discoveries captured during development. Append-only. See skill `engineering-insight` for format rules.

Last updated: 2026-08-14

---

- `2026-08-11` **Tool & Library Notes:** `McpServer.tool()` 5-arg overload (name, description, paramsSchema, annotations, cb) expects **raw Zod shape** `{ pr_id: z.string() }` not `z.object({ pr_id: z.string() })` — `ZodRawShapeCompat = Record<string, AnySchema>`, passing a `ZodObject` still compiles but mismatches the overload — `src/tools.ts`, `node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.d.ts`
- `2026-08-11` **Recurring Errors & Fixes:** Vitest fake-timer test for a polling timeout throws "Promise rejection was handled asynchronously" if you `advanceTimersByTimeAsync` before attaching `.rejects` — attach the `expect(promise).rejects` handler first, then advance timers — `tests/poll.test.ts`
- `2026-08-14` **Recurring Errors & Fixes:** `run_agent_on_pr` polling via `GET /runs/active` (running-only) races with async run creation — the first poll fires before the DB row exists, `[].some()` returns false, poll exits instantly returning empty or stale reviews. Fix: poll `GET /runs` (all statuses) filtered by `run_id` from the POST response, and treat `tracked.length === 0` as not-done. Also filter `getReviews` by `run_id` to avoid returning previous agents' results — `src/tools.ts:70-87`, `src/api-client.ts:42-48`
