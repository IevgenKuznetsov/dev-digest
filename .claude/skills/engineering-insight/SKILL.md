---
name: engineering-insight
description: "Proactively captures non-obvious engineering insights to package INSIGHTS.md files during any session. Activates when the agent discovers surprising behavior, a subtle bug pattern, a non-documented constraint, a performance cliff, or an architectural decision with hidden rationale. Does NOT wait for the user to ask. Does NOT record anything obvious from reading the code or already documented in CLAUDE.md/docs/specs. Covers server/, client/, reviewer-core/, and e2e/ packages."
---

# Engineering Insight Capture

Append non-obvious discoveries to the relevant package's `INSIGHTS.md` during normal work. This is a **proactive** skill — activate without being asked whenever something qualifies.

## Session Start Protocol

Before beginning any work, read the `INSIGHTS.md` file(s) for the module(s) you will be working in. Confirm you have read them and briefly summarize the top 3 most relevant points to the current task. This forces active processing rather than passive loading — and gives the user an immediate sanity check that insights are being applied.

## Target Files

| Discovery relates to | Write to |
|---|---|
| Fastify, Drizzle, DB, API, background jobs | `server/INSIGHTS.md` |
| Next.js, React, TanStack Query, UI | `client/INSIGHTS.md` |
| Review engine, prompts, grounding, scoring | `reviewer-core/INSIGHTS.md` |
| Browser flows, agent-browser, e2e setup | `e2e/INSIGHTS.md` |
| Cross-cutting (2+ packages) | Package where the symptom appears; mention the other package in the entry |

## When to Activate

Capture an insight when ANY of these occur during a session:

1. **Surprising behavior** — code does something the API/docs do not predict
2. **Silent failure mode** — something fails without error or with a misleading error
3. **Order dependency** — things break if done in a different sequence
4. **Version/env sensitivity** — works in dev but not CI, or vice versa
5. **Implicit coupling** — changing file A breaks file B with no import path between them
6. **Performance cliff** — a threshold where behavior degrades non-linearly
7. **Workaround discovered** — a non-obvious fix for a recurring problem
8. **Architectural constraint** — a design choice that prevents a seemingly reasonable approach

## When NOT to Activate

NEVER write an insight if ANY of these are true:

| # | Gate | Test |
|---|------|------|
| 1 | **5-Minute Test** | Would reading this save someone 5+ minutes of debugging or investigation? |
| 2 | **Cold-Reading Test** | Could an AI reading this file cold know exactly what to do or avoid? |
| 3 | **Novelty Test** | Is this absent from CLAUDE.md, docs/, specs/, and existing INSIGHTS.md entries? |
| 4 | **Recurrence Test** | Is this likely to bite someone again (not a one-off)? |
| 5 | **Specificity Test** | Does the entry name a concrete file, function, threshold, or error message? |
| 6 | **Duplicate Test** | Is there no similar entry already in the target INSIGHTS.md? |

If any gate fails, do NOT write the entry. The bar is high — routine debugging, standard library usage, and expected behavior do NOT qualify. The insight must represent something that was surprising, cost real time to discover, or would cause someone else to waste significant time.

## Entry Format

Every entry is exactly one line, appended to the end of the file:

```
- `YYYY-MM-DD` **Topic:** Insight text — `path/to/file.ts:42`
```

### Topic Categories

- **What Works** — approaches, patterns, solutions proven effective
- **What Doesn't Work** — failed approaches, dead ends, antipatterns to avoid
- **Codebase Patterns** — project-specific conventions, architecture decisions, naming patterns
- **Tool & Library Notes** — quirks, gotchas, useful behaviors of dependencies
- **Recurring Errors & Fixes** — common errors encountered and their solutions
- **Session Notes** — timestamped brief summaries of what a session accomplished
- **Open Questions** — things that need more investigation or were left unresolved

### Examples

**GOOD** (specific, actionable, evidence-linked):

```
- `2026-07-31` **Recurring Errors & Fixes:** "relation does not exist" on boot means forgot pnpm db:migrate — migrations are NOT auto-applied — `server/src/db/connection.ts`
- `2026-07-31` **What Doesn't Work:** Promise.all() on ingestion pipeline times out after 30 items — use Promise.allSettled() with batches of 10 — `server/src/modules/ingest/worker.ts:87`
- `2026-07-31` **Codebase Patterns:** Score ignores model's self-reported value because models consistently inflate by 15-25 points — `reviewer-core/src/grounding.ts:61`
- `2026-07-31` **Tool & Library Notes:** Duplicate Zod instances across shared/api break instanceof z.ZodError — error handler uses shape-matching as fallback — `server/src/errors.ts:14`
- `2026-07-31` **What Works:** Embedding batch size capped at 40 prevents OpenAI 429s under default rate limit — `server/src/modules/embeddings/batch.ts:19`
- `2026-07-31` **Open Questions:** Does p-queue respect backpressure when GitHub API returns 403 secondary rate limit? Needs testing — `server/src/modules/github/sync.ts`
```

**BAD** (vague, generic, no evidence — NEVER write these):

```
- Promises can be tricky
- Remember to handle errors
- TypeScript types are important
- The API sometimes returns errors
- Be careful with the database layer
```

## Procedure

1. **Check the 6 anti-banality gates** — stop if any fails
2. **Read the target INSIGHTS.md** — check for duplicates. If a similar entry exists, stop. If it exists but needs updating, update it in-place with the new date
3. **Pick the topic** from the 7 categories above
4. **Pick the target file** from the routing table
5. **Write exactly one line** using the entry format, with file:line evidence
6. **Append to the very end** of the file. NEVER reorder, edit, or delete existing entries. NEVER insert into the middle
7. **Update the "Last updated" date** in the file header
8. **Notify briefly** — print a one-line message: `Insight captured -> server/INSIGHTS.md [Topic]`

## Maintenance

- **Append-only**: NEVER reorder, edit, or delete existing entries during normal work
- **Cap**: ~200 entries per file. When approaching the cap, alert the user
- **Staleness**: Entries referencing code that no longer exists should be flagged during quarterly review
- **Conflicts**: If two entries contradict, the newer one wins — flag for human review
- **Ownership**: INSIGHTS.md is a draft under human review, not an authoritative source