# Unaddressed Issues

Issues flagged by reviewers that require separate handling and were not addressed inline.

---

## CRITICAL — vendor/shared `trace.ts` edited in-place (lesson-5-lab branch)

**Source:** architecture-reviewer, security-reviewer  
**Branch:** lesson-5-lab  
**Date flagged:** 2026-08-16  
**Feature responsible:** project-context

### Description

Both `server/src/vendor/shared/contracts/trace.ts` and `client/src/vendor/shared/contracts/trace.ts`
were edited in-place to widen the `specs_read` field type:

```diff
- specs_read: z.array(z.string()),
+ specs_read: z.array(z.union([z.string(), SpecReadEntry])),
```

This violates the `CLAUDE.md` "Do not touch" rule: `vendor/shared/` is extend-only — new files
may be added, but existing contract files must never be edited.

### Why it was done

The `project-context` feature needs to persist richer data per spec read (`path`, `category`,
`tokens`) in the run trace. The existing `specs_read: z.array(z.string())` field only supports
path strings.

### Assessed fix options

| Option | Tradeoff |
|--------|----------|
| **Revert trace.ts; serialize to path strings** | Loses `category`/`tokens` from the persisted trace. `run-executor.ts:348` maps `specsReadEntries.map(e => e.path)`. Simple, rule-compliant. |
| **Add new field `specs_read_entries` via `RunTrace.extend()`** | Requires a new contract file and changing all downstream consumers/serializers. Architecturally cleanest but highest effort. |
| **Accepted architectural debt** | Leave as-is, document the exception. Risk: sets precedent for future contract mutations. |

### Recommended fix

Revert both `trace.ts` files to the original `specs_read: z.array(z.string())`.
Update `server/src/modules/reviews/run-executor.ts:348`:
```ts
specs_read: specsReadEntries.map(e => e.path),
```

The `SpecReadEntry` type (with `category` and `tokens`) can continue to be used internally
in `project-context/service.ts` — only the persistence to the trace is affected.

### Files involved

- `server/src/vendor/shared/contracts/trace.ts:88`
- `client/src/vendor/shared/contracts/trace.ts:88`
- `server/src/modules/reviews/run-executor.ts:348`
