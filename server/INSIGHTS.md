# Insights

> Draft — entries are under human review. Last updated: 2026-08-01.

- `2026-08-01` **Recurring Errors & Fixes:** On Windows, `import.meta.url === \`file://${process.argv[1]}\`` never matches (forward slashes vs backslashes, triple vs double slash) — CLI entrypoints silently skip execution with no error. Fix: use `pathToFileURL(resolve(process.argv[1])).href` instead — `server/src/db/migrate.ts:37`, `server/src/db/seed.ts:227`