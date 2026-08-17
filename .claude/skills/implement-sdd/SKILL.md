---
name: implement-sdd
description: "Orchestrates the full SDD implementation lifecycle from spec+plan through coding, testing, review, and documentation. TRIGGER: ONLY when the user explicitly invokes /implement-sdd. NEVER activate automatically or proactively. Requires two inputs: a .spec.md file path and a _plan.md file path."
disable-model-invocation: true
metadata:
  author: ievgen.kuznetsov@gmail.com
  version: 1.0.0
---

# SDD Implementation Orchestrator

9-step pipeline that takes a spec and implementation plan through draft documentation, implementation, testing, review, issue resolution, final documentation, and engineering insight capture. Spawns specialized agents for each phase and guides the user through decision points.

**This skill ONLY runs when the user explicitly invokes `/implement-sdd`. Never activate proactively.**

## Inputs

Two required inputs:

1. **Spec file** — path to a `.spec.md` file (e.g., `server/specs/my-feature/my-feature.spec.md`)
2. **Plan file** — path to a `_plan.md` file (e.g., `server/specs/my-feature/my-feature_plan.md`)

Before starting the pipeline:
- Read both files to confirm they exist and are valid
- Extract the feature name and package from the path convention: `<package>/specs/<feature-name>/`
- Print a brief summary of the feature and the number of plan steps

## Pipeline Overview

| Step | Name | User Decision? | Agents Spawned |
|------|------|---------------|----------------|
| 1 | Draft documentation | Yes (opt-in) | doc-writer (background) |
| 2 | Multi-agent splitting | Yes (opt-in) | None |
| 3 | Implementation | No | 1-N implementor |
| 4 | Test writing | Yes (opt-in) | test-writer |
| 5 | Reviewer selection | Yes (multi-select) | None |
| 6 | Run reviewers | No | Selected reviewers (parallel) |
| 7 | Issue handling | Yes (per-issue) | implementor (CRITICAL only); Edit tool for non-critical |
| 8 | Final documentation | No | doc-writer |
| 9 | Engineering insight | No | None (Skill invocation) |

Loop-back: Step 7 can return to implementor → re-run reviewers → step 7 again (with user confirmation each time).

## Procedure

### Step 1: Draft Documentation

Ask the user:
> "Would you like draft documentation created from the spec and plan before implementation begins? This runs in the background and can help identify spec gaps early. (yes/no)"

**If yes:**
- Spawn `doc-writer` agent in background:
  ```
  Agent tool:
    subagent_type: doc-writer
    run_in_background: true
    prompt: |
      Create draft documentation for the following feature. Note: implementation
      has NOT started yet — you are working from the spec and plan only.
      Read the spec and plan files, then create initial documentation structure.
      If anything is hard to describe or seems unclear/contradictory, flag it
      explicitly in your report.

      Spec file: <spec_path>
      Plan file: <plan_path>
      Feature: <feature_name>
      Package: <package_name>
  ```
- Do NOT wait for doc-writer to complete — proceed to Step 2 immediately
- Check doc-writer result before Step 3 begins. If the doc-writer flagged hard-to-describe elements, present them to the user and suggest: "These items were hard to document, which may indicate the spec needs refinement. Consider returning to spec-creator before proceeding."

**If no:** Mark as SKIPPED, proceed to Step 2.

Print status summary after this step.

### Step 2: Multi-Agent Work Splitting

Ask the user:
> "Would you like to split the implementation across multiple implementor agents? (yes/no)"

**If yes:**
1. Parse the plan file and list all steps with their titles in a numbered list
2. Ask the user to assign steps to agents. Example prompt:
   > "Here are the plan steps. Assign step numbers to each agent. Example: Agent 1: steps 1-3, Agent 2: steps 4-6"
3. Validate the assignment:
   - Every step must be assigned to exactly one agent
   - No gaps or overlaps
   - Warn if dependent steps are split across agents (check for "depends on" or "after step N" references in the plan)

**If no:** Single implementor will execute all steps.

Print status summary after this step.

### Step 3: Implementation

**Single agent mode:**
- Spawn one `implementor` agent:
  ```
  Agent tool:
    subagent_type: implementor
    prompt: |
      Execute the implementation plan for the <feature_name> feature.

      Spec file: <spec_path>
      Plan file: <plan_path>

      Follow all steps in the plan in order. Report back with the implementation
      report including completed steps, files changed, test results, and any
      deviations or issues.
  ```

**Multi-agent mode:**
- Spawn N `implementor` agents in parallel:
  ```
  Agent tool (for each agent):
    subagent_type: implementor
    run_in_background: true
    prompt: |
      Execute steps <assigned_steps> of the implementation plan for <feature_name>.

      Spec file: <spec_path>
      Plan file: <plan_path>

      ONLY implement the steps assigned to you: <step_list_with_titles>.
      Do not implement other steps. Report back with the implementation report.
  ```
- Wait for all agents to complete

**After completion:**
- If any agent reports "plan is wrong or incomplete" → surface the issue immediately and suggest returning to the implementation-planner
- Print a summary of all agents' results: steps completed, files changed, tests passed/failed, deviations, issues discovered

**Post-implementation sanity check:** Run this grep across the new module directories
to catch bare property access expressions — dead no-ops left by interrupted refactors:

```sh
grep -rn "^\s*this\.[a-zA-Z_]\+;" <new_module_paths>
```

If any matches are found, fix them inline with the Edit tool before Step 4. This
takes under 30 seconds and prevents a recurring [architecture-reviewer] LOW finding.

Print status summary after this step.

### Step 4: Test Writing (Optional)

Ask the user:
> "Would you like to run the test-writer agent? This can be skipped to conserve tokens. (yes/no)"

**If yes:**
- Spawn `test-writer` agent:
  ```
  Agent tool:
    subagent_type: test-writer
    prompt: |
      Write tests for the <feature_name> feature based on the spec and plan.

      Spec file: <spec_path>
      Plan file: <plan_path>

      Read the spec for acceptance criteria and the plan for test requirements
      tagged in each step. Write tests following project conventions
      (*.test.ts for unit, *.it.test.ts for integration).
  ```
- Wait for completion
- Print: files created, test pass/fail counts, gaps noted

**If no:** Mark as SKIPPED.

Print status summary after this step.

### Step 5: Reviewer Selection

Ask the user:
> "Which reviewers would you like to run? Select one or more:
> 1. architecture-reviewer — checks architecture boundaries and layer violations
> 2. plan-verifier — verifies implementation against plan point-by-point
> 3. security-reviewer — scans for security vulnerabilities
> 4. All of the above"

Record the selection for Step 6.

Print status summary after this step.

### Step 6: Run Reviewers

Spawn all selected reviewers in parallel:

**architecture-reviewer:**
```
Agent tool:
  subagent_type: architecture-reviewer
  run_in_background: true
  prompt: |
    Review the current branch for architecture violations.
    This is for the <feature_name> feature.
```

**security-reviewer:**
```
Agent tool:
  subagent_type: security-reviewer
  run_in_background: true
  prompt: |
    Review the current branch for security vulnerabilities.
    This is for the <feature_name> feature.
```

**plan-verifier:**
```
Agent tool:
  subagent_type: plan-verifier
  run_in_background: true
  prompt: |
    Verify the implementation against the plan point-by-point.
    Plan file: <plan_path>
    Spec file: <spec_path>
```

Wait for all selected reviewers to complete. Then:

1. Present findings grouped by reviewer
2. Compile a combined severity summary:
   ```
   Severity Summary:
   - CRITICAL: N
   - HIGH: N
   - MEDIUM: N
   - LOW: N
   ```

Print status summary after this step.

### Step 7: Issue Handling

This step has two tiers. Always process Tier 1 before Tier 2.

#### Tier 1 — CRITICAL Issues

If there are CRITICAL findings:

1. Present a numbered list of all critical issues:
   ```
   CRITICAL Issues:
   1. [architecture-reviewer] path/to/file.ts:42 — Description of violation
   2. [security-reviewer] path/to/file.ts:15 — Description of vulnerability
   ```

2. Ask the user:
   > "N critical issue(s) found. Would you like to start a fix loop? The implementor will address these issues and the affected reviewers will re-run. (yes/no)"

3. **If yes:**
   - Spawn implementor agent(s) to fix the specific critical issues:
     ```
     Agent tool:
       subagent_type: implementor
       prompt: |
         Fix the following CRITICAL issues found by reviewers for <feature_name>.

         Spec file: <spec_path>
         Plan file: <plan_path>

         Issues to fix:
         <numbered_list_of_critical_findings_with_file_line_and_description>

         Fix only these issues. Do not make other changes.
     ```
   - After implementor completes, re-run ONLY the reviewers that originally flagged critical issues (not all reviewers)
   - Present new findings
   - If critical issues remain, ask the user again (always ask — never auto-loop)
   - After 3 retry cycles, recommend manual intervention:
     > "3 fix attempts completed but critical issues remain. Consider addressing these manually."

4. **If no:** Proceed to Tier 2.

#### Tier 2 — Non-Critical Issues (HIGH/MEDIUM/LOW)

If there are any non-critical findings remaining:

1. Present the full list grouped by severity:
   ```
   Remaining Issues:

   HIGH:
   1. [reviewer] file:line — description

   MEDIUM:
   1. [reviewer] file:line — description

   LOW:
   1. [reviewer] file:line — description
   ```

2. Ask the user:
   > "These non-critical issues were found. Would you like to address any of them before continuing? (yes/no)"

3. **If yes:**
   - Ask which issues to fix (by number)
   - For each selected issue: read the file at the referenced path and apply the fix directly using the Edit tool in the main conversation context. Do NOT spawn an implementor agent for non-critical fixes — these are small targeted changes that should be made inline.
   - After all edits are applied, re-run only the affected reviewers
   - Present updated findings and return to Tier 2 assessment

4. **If no:** Proceed to Step 8.

> **Rationale:** Non-critical fixes are small and localized. Spawning a full implementor agent for a one-line edit wastes tokens and context. Reserve `implementor` for CRITICAL issues that require broad rework across multiple files.

If there are zero findings across all reviewers, print "No issues found by any reviewer." and proceed to Step 8.

Print status summary after this step.

### Step 8: Final Documentation

Spawn `doc-writer` agent:
```
Agent tool:
  subagent_type: doc-writer
  prompt: |
    Write final documentation for the <feature_name> feature.
    Implementation is now complete — read the actual code, not just the plan.

    Spec file: <spec_path>
    Plan file: <plan_path>
    Package: <package_name>

    If draft documentation was created earlier in <package>/docs/<FeatureName>/,
    update it rather than creating duplicates.
```

Wait for completion. Print the documentation report: files created/updated, diagrams included.

Print status summary after this step.

### Step 9: Engineering Insight

Invoke the `engineering-insight` skill:
```
Skill tool:
  skill: "engineering-insight"
```

This runs in the main conversation context. The skill will determine if any insights from this implementation session qualify for capture.

Print final status summary showing all steps complete.

## Status Summaries

After each step completes, print a compact pipeline status block:

```
--- implement-sdd Pipeline ---
[1] Draft docs:      COMPLETE
[2] Work splitting:  COMPLETE (single agent)
[3] Implementation:  COMPLETE
[4] Tests:           SKIPPED
[5] Reviewer select: COMPLETE (architecture-reviewer, plan-verifier)
[6] Run reviewers:   COMPLETE
[7] Issue handling:  COMPLETE (1 critical fixed, 2 non-critical accepted)
[8] Final docs:      IN PROGRESS
[9] Eng. insight:    PENDING
-------------------------------
```

States: `PENDING`, `IN PROGRESS`, `COMPLETE`, `SKIPPED`, `FAILED`

Include brief context in parentheses where useful (agent count, reviewer names, fix counts).

## Error Handling

| Scenario | Action |
|----------|--------|
| Agent fails or times out | Report the failure, ask user if they want to retry that specific agent |
| Implementor reports plan is wrong | Surface immediately, suggest returning to implementation-planner |
| Spec or plan file unreadable | Stop immediately, report the error |
| Doc-writer flags spec gaps (Step 1) | Present findings, suggest returning to spec-creator |
| Agent returns empty/malformed output | Report, ask user to retry |

**Never proceed past a failed step without user acknowledgment.**

## What This Skill Does NOT Do

- Does not activate automatically — explicit `/implement-sdd` invocation only
- Does not create specs — use `spec-creator` agent
- Does not create plans — use `implementation-planner` agent
- Does not write code directly — delegates to `implementor` agents
- Does not make architectural decisions — delegates to reviewers
- Does not auto-fix issues without user permission at every step
- Does not use TaskCreate/TaskUpdate — uses text status summaries only
