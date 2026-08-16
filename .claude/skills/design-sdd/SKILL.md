---
name: design-sdd
description: "Orchestrates the full SDD design pipeline for a new feature: collects context, drives spec-creator with a suggest-then-confirm QA gate, gets user approval on the spec, drives implementation-planner, and verifies the plan against the spec with an independent cross-review. TRIGGER: ONLY when the user explicitly invokes /design-sdd. NEVER activate automatically or proactively."
disable-model-invocation: true
metadata:
  author: ievgen.kuznetsov@gmail.com
  version: 1.0.0
---

# SDD Design Orchestrator

5-phase pipeline that takes a feature idea through context gathering, spec creation with multi-round QA gating, user approval, plan creation, and independent plan verification.

**This skill ONLY runs when the user explicitly invokes `/design-sdd`. Never activate proactively.**

## Pipeline Overview

| Phase | Name | User Decision? | Agents Spawned |
|-------|------|---------------|----------------|
| 1 | Context gathering | Yes (answers) | None |
| 2 | Spec creation loop | Yes (QA gate every round) | spec-creator |
| 3 | Spec approval | Yes (approve / reject) | None |
| 4 | Planning | Yes (opt-in) | implementation-planner |
| 5 | Plan cross-review | No | general-purpose (sonnet) |

---

## Phase 1: Context Gathering

Ask the user all of the following questions **in a single message** (do not send them one at a time):

> **1. Feature name** — What should this feature be called? This becomes the directory/file name (use kebab-case internally).
>
> **2. Design artifacts** — Do you have any existing documentation, diagrams, PRDs, or design docs for this feature? If yes, provide the file path(s) or paste the content here.
>
> **3. Feature details** — Describe the feature in as much detail as you have right now. What problem does it solve? Who uses it? What are the key behaviors? Any known constraints?
>
> **4. QA rounds** — How many rounds of clarifying questions should spec-creator run? Each round: spec-creator asks questions → you review and confirm Claude's suggested answers → answers go to spec-creator. Recommended: 2 for simple features, 3-4 for complex ones.
>
> **5. Target package** — Which package does this feature belong to? (`server`, `client`, `reviewer-core`, or cross-package)

Wait for the user's response before proceeding. If any answer is ambiguous, ask a single follow-up to clarify it.

Store these values internally:
- `feature_name` — kebab-case version of the feature name
- `design_artifacts` — file paths or pasted content, or `none`
- `feature_details` — the full description provided
- `qa_rounds` — integer, minimum 1
- `target_package` — `server`, `client`, `reviewer-core`, or `cross-package`

Print a brief summary of what you collected and show the status block, then proceed to Phase 2.

---

## Phase 2: Spec Creation Loop

### Initial Agent Launch

Spawn the `spec-creator` agent (foreground — wait for response):

```
Agent tool:
  subagent_type: spec-creator
  prompt: |
    Create a specification for the following feature.

    Feature name: <feature_name>
    Target package: <target_package>

    Feature description:
    <feature_details>

    <if design_artifacts != none>
    Design artifacts provided by the user:
    <design_artifacts>
    </if>

    Configuration:
    - Run exactly <qa_rounds> round(s) of clarifying questions.
    - In each round, ask all your questions at once (not one at a time).
    - After the final round, produce the .spec.md file at:
      <target_package>/specs/<feature_name>/<feature_name>.spec.md
    - After writing the file, output: SPEC_COMPLETE: <file_path>

    Begin round 1 now: ask all clarifying questions for this round.
```

### QA Gate (repeat for each round)

When spec-creator returns a set of questions:

1. **Parse the questions** — list them numbered.

2. **Propose answers** — For each question, write your suggested answer with a one-line rationale. Format:
   ```
   Q1: <question text>
   Suggested answer: <your answer>
   Rationale: <why this is the right answer given the context>

   Q2: ...
   ```

3. **Present to user** — Send your proposed answers in a single message and ask:
   > "These are my suggested answers to spec-creator's questions. Review each one — edit any you disagree with, or reply 'approved' if all are good."

4. **Wait for user approval** — Do NOT send any answers to spec-creator until the user has explicitly approved or edited the answers. If the user edits answers, confirm the final set before proceeding.

5. **Continue spec-creator** — Use SendMessage to resume the spec-creator agent with the approved answers:
   ```
   SendMessage:
     to: spec-creator
     message: |
       Here are the answers to your questions:

       <approved Q&A pairs, formatted clearly>

       <if more rounds remain>
       Please proceed to round <N> of <qa_rounds>: ask all clarifying questions for this round.
       </if>
       <if this was the final round>
       All rounds complete. Please now produce the spec file.
       </if>
   ```

6. **Wait for next response** — spec-creator will either ask the next round of questions (repeat from step 1) or signal completion with `SPEC_COMPLETE: <path>`.

### Round Tracking

Display remaining rounds before each QA gate:
> `[Spec QA: Round N of <qa_rounds>]`

If spec-creator asks a follow-up before all rounds are used, treat it as the next round.

### Completion

When spec-creator outputs `SPEC_COMPLETE: <path>`:
- Store `spec_path` internally
- Read the spec file
- Proceed to Phase 3

---

## Phase 3: Spec Approval

Read `spec_path` and display the **full contents** of the spec file to the user with no truncation.

Then ask:
> "This is the generated spec. Do you approve it?
> - **approved** — proceed to planning
> - **reject: <notes>** — restart spec creation with your feedback"

**If approved:** Proceed to Phase 4.

**If rejected:**
- Extract the rejection notes
- Re-run Phase 2 entirely with a modified initial prompt that includes:
  ```
  Previous spec was rejected by the user. Rejection feedback:
  <rejection_notes>

  Previous spec for reference:
  <contents of previous spec>

  Please create a revised spec addressing the feedback.
  ```
- Run the full QA loop again (same `qa_rounds` count)
- Return to Phase 3 after completion

---

## Phase 4: Planning (Optional)

Ask the user:
> "Spec approved. Would you like to run the implementation-planner now to generate a development plan? (yes / no)"

**If no:** Print the final status block and exit. Remind the user they can run `/implement-sdd` with the spec later once they have a plan.

**If yes:** Spawn `implementation-planner` agent (foreground — wait for completion):

```
Agent tool:
  subagent_type: implementation-planner
  prompt: |
    Create an implementation plan for the following feature.

    Spec file: <spec_path>
    Target package: <target_package>

    Read the spec carefully. Ask any clarifying questions you need before
    producing the plan. Write the plan to:
      <target_package>/specs/<feature_name>/<feature_name>_plan.md

    After writing the file, output: PLAN_COMPLETE: <file_path>
```

When the planner outputs `PLAN_COMPLETE: <path>`:
- Store `plan_path` internally
- Read the plan file
- Proceed to Phase 5

---

## Phase 5: Plan Cross-Review

Spawn a `general-purpose` agent with the **sonnet** model to perform an independent review of the plan against the spec. This is a second-opinion check — a different model reviewing what the planner produced.

```
Agent tool:
  subagent_type: general-purpose
  model: sonnet
  prompt: |
    You are performing a cross-review of an implementation plan against its feature spec.
    Your job is to find gaps, missing requirements, ambiguities, or risks — not to
    rewrite the plan, just to audit it rigorously.

    Read both files now:

    Spec file: <spec_path>
    Plan file: <plan_path>

    For every requirement in the spec, determine whether the plan covers it.
    Use this format for each:

    REQ-<N>: <requirement summary from spec>
    Status: COVERED | PARTIAL | MISSING
    Evidence: <quote from plan that covers it, or explanation of the gap>

    After the per-requirement table, add:

    ## Risk Flags
    List any implementation risks, underspecified steps, dependencies not accounted for,
    or decisions left open that could cause problems during implementation.

    ## Summary
    Total: <N> requirements
    Covered: <N> | Partial: <N> | Missing: <N>
    Overall verdict: READY | NEEDS REVISION
```

Wait for the cross-review to complete.

### Present Findings

Display the full cross-review output to the user.

If verdict is `NEEDS REVISION` or there are any PARTIAL/MISSING items:

> "The cross-review found gaps. Here are the options:
> 1. **Re-run planner** — I will feed the gaps back to implementation-planner and generate a revised plan
> 2. **Accept as-is** — proceed with the current plan (note the gaps for implementation)
> 3. **Manually fix** — you will edit the plan file directly; tell me when done and I will re-run the cross-review"

Handle user's choice:
- **Re-run planner**: Feed the cross-review output and gap list back to implementation-planner (Phase 4 style), then re-run Phase 5.
- **Accept as-is**: Continue to final presentation.
- **Manually fix**: Wait for user confirmation, read the updated plan, re-run the cross-review agent.

If verdict is `READY` with zero MISSING items:
> "Cross-review passed — all spec requirements are covered by the plan."

---

## Final Presentation

Print the following:

```
--- design-sdd Complete ---

Feature: <feature_name>
Package: <target_package>

Spec:  <spec_path>
Plan:  <plan_path> (or "not created")

Cross-review: READY / NEEDS REVISION (accepted with N gaps)

Next step: /implement-sdd <spec_path> <plan_path>
---------------------------
```

---

## Status Block

After each phase completes, print a compact status block:

```
--- design-sdd Pipeline ---
[1] Context:       COMPLETE
[2] Spec creation: COMPLETE (3 QA rounds)
[3] Spec approval: COMPLETE
[4] Planning:      IN PROGRESS
[5] Cross-review:  PENDING
---------------------------
```

States: `PENDING`, `IN PROGRESS`, `COMPLETE`, `SKIPPED`, `FAILED`

---

## Error Handling

| Scenario | Action |
|----------|--------|
| spec-creator fails or times out | Report failure, ask user to retry Phase 2 |
| spec-creator never outputs `SPEC_COMPLETE` after all rounds | Read the last response and attempt to extract the spec file path; if not found, ask spec-creator explicitly |
| implementation-planner fails | Report failure, ask if user wants to retry Phase 4 |
| Cross-review agent fails | Report failure, ask if user wants to retry or skip Phase 5 |
| Spec file not found after SPEC_COMPLETE | Read the path from agent output, verify with Glob; if missing, ask spec-creator to re-output it |
| Plan file not found after PLAN_COMPLETE | Same as above for plan file |

**Never proceed past a failed phase without user acknowledgment.**

---

## What This Skill Does NOT Do

- Does not activate automatically — explicit `/design-sdd` invocation only
- Does not implement code — use `/implement-sdd` after this pipeline
- Does not write the spec or plan itself — delegates entirely to spec-creator and implementation-planner
- Does not auto-approve any user decision point
- Does not send answers to spec-creator before user confirms them
