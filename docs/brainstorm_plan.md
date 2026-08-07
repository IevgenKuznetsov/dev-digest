# Implementation Plan: Brainstorm Agent

**Scope:** `.claude/agents/` (agent definition only)
**Estimated complexity:** low
**Created:** 2026-08-06

## Context

The project needs a multi-planner orchestrator agent that spawns N planner agents in parallel
for the same problem, collects their independent solutions, and produces a structured comparison
with advantages and disadvantages of each approach. This helps users explore the solution space
before committing to an implementation direction.

## Architecture Constraints

- Agent definitions live in `.claude/agents/<name>.md` — source: existing convention.
- Agents use YAML frontmatter (name, description, tools, model, effort, optional skills) + markdown body — source: all 7 existing agent files.
- Orchestrator agents use the `Agent` tool to spawn sub-agents — source: `planner.md` (spawns `researcher`).
- Model selection: `opus` for high-reasoning tasks — source: `README.md` table.
- Read-only agents omit Edit/Write tools — source: `architecture-reviewer.md`, `plan-verifier.md`.

## Pre-implementation Checklist

- [ ] Migration needed? No
- [ ] New module needed? No
- [ ] New shared contracts needed? No
- [ ] New adapter needed? No

## Steps

### Step 1: Create brainstorm agent definition

**Package:** `.claude/agents/`
**Files:** `.claude/agents/brainstorm.md` (create)
**What:** Create the agent definition file with frontmatter and body following the established pattern.

**Frontmatter specification:**
- `name: brainstorm`
- `description:` Multi-planner orchestrator that spawns N planner agents in parallel to generate independent solutions for the same problem, then compares all approaches with pros and cons to help the user pick the best solution or combine ideas.
- `tools:` Read, Grep, Glob, Bash, Agent, AskUserQuestion, TaskCreate, TaskUpdate
- `model: opus` — high reasoning needed to compare and synthesize multiple plans
- `effort: high`
- No `skills:` block — delegates planning to planner sub-agents which have their own skills

**Body specification — must include these sections:**

1. **Ground Rules:**
   - Read-only — does not create or edit files (no Write/Edit tools). Only reads, orchestrates, and reports.
   - Clarify before spawning — use AskUserQuestion to confirm the problem statement and the number of parallel planners if not already specified. Default to 3.
   - Parallel execution — spawn ALL planner agents concurrently using the Agent tool with `subagent_type: planner` and `run_in_background: true`. Each planner gets the same problem but an instruction to explore independently.
   - Wait for all — do not begin comparison until every planner has returned.
   - No favoritism — analyze each plan with equal depth and objectivity.
   - Label plans — assign each plan a letter label (Plan A, Plan B, Plan C...) for easy reference.

2. **Orchestration Workflow:**
   1. Parse the user's problem/task description.
   2. If not specified, ask the user how many parallel solutions to generate (default 3, recommend 2-5).
   3. Craft planner prompts — each gets the same problem description plus an instruction to explore its own approach independently. Vary the prompt slightly to encourage diversity (e.g., "prioritize simplicity", "prioritize extensibility", "prioritize minimal changes").
   4. Spawn N planner agents in parallel using Agent tool with `run_in_background: true`.
   5. Collect all returned plans.
   6. Analyze and compare using the comparison criteria.
   7. Produce the comparison report.

3. **Comparison Criteria** (evaluate each plan on):
   - Scope and complexity (estimated effort, number of steps/files)
   - Architecture fit (constraint compliance, layer discipline)
   - Risk profile (risks identified and mitigations)
   - Testability (coverage strategy, test complexity)
   - Extensibility (how well the approach handles future changes)
   - Simplicity (least moving parts, least cognitive load)

4. **Output Format:** Structured markdown with:
   - Summary table comparing all plans across criteria (using a rating scale)
   - Detailed pros/cons for each plan
   - Recommendation section — which plan to pick or which ideas to combine
   - Never auto-select — present the comparison and let the user decide

**Skills:** none
**Tests:** No automated tests — manual verification by invocation.
**Depends on:** none

## Proactive Skills That Will Fire

- `engineering-insight` — won't fire (only 1 file created)

## Risk Assessment

- **Risk: Plans too similar** — if all planners converge on the same solution, the comparison provides little value. Mitigation: vary prompts to encourage different angles (simplicity vs extensibility vs minimal changes).
- **Risk: Overwhelming output** — many planners produce very long reports. Mitigation: default to 3, recommend cap at 5. Comparison uses summary table for quick scanning.

## Out of Scope

- No new skills created.
- No server/client code changes.
- No modifications to existing agents.
