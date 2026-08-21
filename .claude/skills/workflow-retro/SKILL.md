---
name: workflow-retro
description: "User-invocable session retrospective. Reads the agent session log, git history, and conversation context to produce: session timeline, per-agent call counts, token cost estimates (by tier), loop-back and code-quality signals, and concrete workflow improvement suggestions. TRIGGER: ONLY when the user explicitly invokes /workflow-retro. Never activate automatically."
metadata:
  author: ievgen.kuznetsov@gmail.com
  version: 1.0.0
---

# Workflow Retrospective

Produces a structured end-of-session report from four data sources:
1. `.claude/session-log.jsonl` — machine-accurate agent call log (written by the PostToolUse hook)
2. `.claude/retro-trend.jsonl` — append-only trend ledger across all past sessions
3. `git log / git diff` — ground-truth record of what was committed and changed
4. Conversation context — visible turn history for loop-back and quality signal analysis

**Only runs when explicitly invoked with `/workflow-retro`. Never auto-activate.**

---

## Step 0 — Load trend ledger

```bash
cat .claude/retro-trend.jsonl 2>/dev/null || echo "NO_TREND"
```

Parse each line as a JSON object:
```
{ date, commits, agents_total, token_estimate_mid, loop_backs: [{severity, signal, detail}], quality_wins: [], suggestions: [] }
```

Take the **last 5 entries** (most recent sessions). Compute:
- **Recurring signals**: loop-back `signal` values that appear in ≥2 of the last 5 sessions — these are systemic problems
- **Token trajectory**: is `token_estimate_mid` trending up, down, or flat across sessions?
- **Quality trend**: are `quality_wins` growing or shrinking?
- **Suggestions acted on**: signals from past suggestions that no longer appear as loop-backs this session

Store this for use in the TRENDS report section and in the improvement suggestions step.

If `NO_TREND`, note "First session — no historical data."

---

## Step 1 — Collect raw data (run all commands)

Run these bash commands. If a command fails, note the failure and continue.

```bash
# Agent call log (today's session)
cat .claude/session-log.jsonl 2>/dev/null || echo "NO_LOG"

# Commits made this session (branch vs main)
git log --oneline main..HEAD 2>/dev/null || git log --oneline -20

# Files changed with line counts
git diff --stat main..HEAD 2>/dev/null || git diff --stat HEAD~5..HEAD

# Raw numstat for totals
git diff --numstat main..HEAD 2>/dev/null || git diff --numstat HEAD~5..HEAD
```

Store the outputs internally. Do not print them raw.

---

## Step 2 — Parse agent log

Parse each JSONL line from the session log into a structured list:
```
{ ts, subagent, description, background, isolation, model, tokens, tool_uses, duration_ms, outcome }
```

`description` = what the agent was asked to do; `outcome` = what it actually produced (first 150 chars of result, foreground only). Use `outcome` to verify the agent completed its task vs. got stuck or produced an error.

If `NO_LOG` was returned (hook not yet active or no agents spawned), note this and
estimate agent calls from the visible conversation context instead.

Group by `subagent` type and count calls. Note which ran in background vs foreground.

---

## Step 3 — Estimate token cost

For each agent call, assign a cost tier using this table:

| Subagent | Tier | Est. tokens (input+output) |
|---|---|---|
| `Explore` (quick thoroughness) | low | ~8k |
| `Explore` (medium / unspecified) | low-med | ~20k |
| `Explore` (very thorough) | medium | ~50k |
| `general-purpose` | medium | ~30k |
| `researcher` | medium | ~25k |
| `plan-verifier` | low–high | ~15k (plan <200 lines) to ~80k (plan >500 lines) |
| `architecture-reviewer` | medium | ~20k |
| `security-reviewer` | medium | ~20k |
| `test-writer` | medium | ~40k |
| `doc-writer` | medium | ~35k |
| `implementor` | high | ~60k |
| `brainstorm` | high | ~40k orchestrator + N×100k per spawned planner |
| `spec-creator` | very-high | ~100k |
| `implementation-planner` | very-high | ~100k |

**Model multiplier:** If `model` field is `opus`, multiply tier estimate by 1.5×.
If `model` is `haiku`, multiply by 0.4×.

**Main conversation:** Add a baseline of ~40k for the orchestrating conversation,
plus ~8k per substantial task (file edits, multi-step instructions).

**Total:** Sum all agent estimates + main conversation baseline.
Express as a range: ±30% of the midpoint (e.g. "~180k–320k tokens").

Confidence note:
- HIGH confidence if session-log.jsonl was present (accurate call count)
- LOW confidence if estimated from conversation context (call count may be off)

---

## Step 4 — Analyze loop-backs and code quality signals

Scan the visible conversation context and git diff for these patterns.
For each signal found, record: what happened, how many iterations, which files/agents.

### Loop-back signals (ordered by severity)

| Signal | How to detect | Severity |
|---|---|---|
| **Type error loops** | Multiple `pnpm typecheck` / `tsc` runs with fixes in between | high |
| **Same file edited 3+ times** | Git diff shows file + conversation shows repeated edits | high |
| **Agent re-spawn same type** | Same subagent called 2+ times in sequence (same task area) | medium |
| **Explicit user redirect** | User messages with "wrong", "incorrect", "not what I meant", "try again", "fix" | medium |
| **Test failures requiring iteration** | `pnpm test` failures followed by code changes + rerun | medium |
| **Scope creep** | Tasks created then description changed, or new tasks added mid-implementation | low |
| **Plan deviation** | Implementation diverged from stated plan (visible in conversation) | low |

### Quality signals (positive)

| Signal | How to detect |
|---|---|
| **Single-pass implementation** | File edited once, typecheck passed, done |
| **Agent used appropriately** | Right agent type for the task (Explore for discovery, implementor for code) |
| **Parallel agent use** | Multiple agents run in background simultaneously |
| **Tasks tracked** | TaskCreate/TaskUpdate used to organize work |

---

## Step 5 — Synthesize improvement suggestions

Pull in recurring signals identified in Step 0. If a signal recurred from a prior session and also appeared this session, escalate its priority — label it `[RECURRING]` in the suggestion.

Based on the signals found, generate 3–6 concrete suggestions. Each must be:
- **Specific** — name the pattern that triggered it
- **Actionable** — say exactly what to do differently next session
- **Non-obvious** — not generic advice like "write better code"

Examples of good suggestions:
- "3 typecheck iterations on `RepoScanModal.tsx` — run `pnpm typecheck` after the first draft of any new component before moving to the next file"
- "Explore agent was spawned twice for the same module — a single thorough run would have gathered all needed context"
- "The `deleteDoc` behavior was changed mid-implementation after user correction — verify destructive operation semantics with the user before starting implementation"

Examples of bad suggestions (do NOT generate these):
- "Write better code"
- "Plan more carefully"
- "Use the right tools"

---

## Step 6 — Output the report

Print the full report to the conversation. Do not write to any file yet (the trend write happens in Step 6.5).

Use this exact format:

```
--- Workflow Retrospective — YYYY-MM-DD ---

TRENDS (last 5 sessions)
Recurring issues   : [signal names that appeared ≥2/5 sessions, or "None"]
Token trajectory   : [e.g. "↑ rising: 120k → 180k → 250k" or "→ flat" or "↓ falling" or "N/A (first session)"]
Quality trajectory : [e.g. "improving — quality_wins growing" or "flat" or "N/A"]
Acted on           : [suggestions from prior sessions whose signal did NOT recur, or "N/A"]

SESSION TIMELINE
[Bullet list of what was built, in chronological order, derived from git log +
 conversation. 1 line per logical unit of work. Example:
 • Fixed EmptyState button text (duplicate + icon)
 • Added server endpoints: GET /context/find, POST /context/import
 • Added Project Context settings section with pattern config]

AGENT USAGE
Subagent              | Calls | Model    | Bg? | Worktree? | Tier     | Est. tokens
----------------------|-------|----------|-----|-----------|----------|------------
Explore               |   2   | sonnet   | no  | no        | low-med  | ~40k
general-purpose       |   1   | sonnet   | no  | no        | medium   | ~30k
[... one row per subagent type used ...]
Note: if any agent's outcome field contains "error" or "failed", flag it under LOOP-BACKS.

Main conversation overhead:                               ~80k
─────────────────────────────────────────────────────────────
TOTAL ESTIMATE:                              ~150k–270k tokens
Confidence: HIGH (session log present) / LOW (estimated from context)

LOOP-BACKS & QUALITY SIGNALS

Issues found:
  [HIGH]   Type error loop — pnpm typecheck run 3 times on SettingsProjectContext.tsx
  [MEDIUM] User redirect — "delete file should not remove from disk" caught post-implementation
  [LOW]    Scope added mid-session — delete behavior, badge colors, path display

What worked well:
  • 5 of 6 server-side changes passed typecheck on first attempt
  • Agent tool used for codebase discovery (appropriate delegation)
  • Tasks tracked throughout session

IMPROVEMENT SUGGESTIONS
1. [from: type error loop] ...
2. [from: user redirect on deleteDoc] ...
3. [from: mid-session scope] ...

--- End Retrospective ---
```

Keep the report factual and terse. No padding. No "great job!" filler.
If a section has no data (e.g. no loop-backs found), write "None detected."

---

## Step 6.5 — Append to trend ledger

After printing the report, append one entry to `.claude/retro-trend.jsonl` using the Bash tool:

```bash
node -e "
const fs = require('fs');
const entry = {
  date: '<YYYY-MM-DD>',
  commits: <N>,
  agents_total: <N>,
  token_estimate_mid: <midpoint number from total estimate, no k suffix>,
  loop_backs: [
    // one object per issue found: { severity: 'high'|'medium'|'low', signal: '<signal_key>', detail: '<brief description>' }
  ],
  quality_wins: [
    // array of signal key strings, e.g. 'single_pass_implementation', 'parallel_agents', 'tasks_tracked'
  ],
  suggestions: [
    // array of suggestion strings (first ~80 chars each)
  ]
};
fs.appendFileSync('.claude/retro-trend.jsonl', JSON.stringify(entry) + '\n');
"
```

Use these canonical `signal` key values for `loop_backs` (matches Step 4 table):
`type_error_loop`, `repeated_file_edits`, `agent_respawn`, `user_redirect`, `test_failure_loop`, `scope_creep`, `plan_deviation`

Use these canonical values for `quality_wins`:
`single_pass_implementation`, `appropriate_agent_use`, `parallel_agents`, `tasks_tracked`

If a field cannot be determined, use `null` for scalars and `[]` for arrays.
**Never skip this step.** The trend ledger is only useful if it is written every session.

---

## What this skill does NOT do

- Does not make git commits or code changes
- Does not spawn agents
- Does not report on code that was not committed (only git-tracked changes)
- Does not guess exact token counts — always uses tier estimates with confidence label
