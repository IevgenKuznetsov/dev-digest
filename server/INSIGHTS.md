# Insights

> Draft — entries are under human review. Last updated: 2026-08-01.

- `2026-08-01` **Recurring Errors & Fixes:** On Windows, `import.meta.url === \`file://${process.argv[1]}\`` never matches (forward slashes vs backslashes, triple vs double slash) — CLI entrypoints silently skip execution with no error. Fix: use `pathToFileURL(resolve(process.argv[1])).href` instead — `server/src/db/migrate.ts:37`, `server/src/db/seed.ts:227`
- `2026-08-01` **What Doesn't Work:** Extending a vendor/shared Zod schema with `.nullable()` (e.g. `RunSummary.extend({ cost_usd: z.number().nullable() })`) makes the field **required** in the object — every existing consumer constructing the base type without it fails typecheck. Use `.nullish()` instead for backward-compatible optional+nullable fields — `server/src/vendor/shared/contracts/run-cost.ts`