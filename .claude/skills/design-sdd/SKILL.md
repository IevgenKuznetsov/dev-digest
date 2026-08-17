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
- `qa_history` — empty list, will accumulate `{ round, questions_and_answers }` entries

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

5. **Record the round** — Append to `qa_history`:
   ```
   { round: N, questions_and_answers: "<approved Q&A pairs, one per line: Q: ... / A: ...>" }
   ```

6. **Spawn the next spec-creator** — Spawn a fresh `spec-creator` agent with all accumulated context. **Never use SendMessage** — spec-creator cannot be continued via relay; always re-spawn with the full history in the prompt.

   **If more rounds remain (current round < qa_rounds):**
   ```
   Agent tool:
     subagent_type: spec-creator
     prompt: |
       You are continuing a spec creation session. Rounds 1 through <N> are complete
       and approved. You are now in Round <N+1> of <qa_rounds>.

       DO NOT re-ask any question from a previous round. All prior answers are final.
       Jump directly to asking Round <N+1> questions.

       Feature name: <feature_name>
       Target package: <target_package>

       Feature description:
       <feature_details>

       <if design_artifacts != none>
       Design artifacts:
       <design_artifacts>
       </if>

       ## Resolved decisions (Rounds 1–<N>)
       <for each entry in qa_history:>
       ### Round <round>
       <questions_and_answers verbatim>

       Configuration:
       - You are in Round <N+1> of <qa_rounds>. Ask all Round <N+1> clarifying questions now.
       - After the final round is answered, produce the spec file at:
           <target_package>/specs/<feature_name>/<feature_name>.spec.md
       - After writing the file, output: SPEC_COMPLETE: <file_path>

       Begin Round <N+1> now.
   ```

   **If this was the final round (current round = qa_rounds):**
   ```
   Agent tool:
     subagent_type: spec-creator
     prompt: |
       You are completing a spec creation session. All <qa_rounds> rounds of clarifying
       questions have been answered. Produce the final spec file now.

       DO NOT ask any more questions. Proceed directly to writing the spec.

       Feature name: <feature_name>
       Target package: <target_package>

       Feature description:
       <feature_details>

       <if design_artifacts != none>
       Design artifacts:
       <design_artifacts>
       </if>

       ## All Resolved Decisions (Rounds 1–<qa_rounds>)
       <for each entry in qa_history:>
       ### Round <round>
       <questions_and_answers verbatim>

       Produce the spec file at:
         <target_package>/specs/<feature_name>/<feature_name>.spec.md
       After writing the file, output: SPEC_COMPLETE: <file_path>
   ```

7. **Wait for response** — spec-creator will either return the next round's questions (repeat from step 1) or output `SPEC_COMPLETE: <path>`.

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

    Read the spec carefully. Before asking the user clarifying questions,
    first try to resolve them by reading the codebase — CLAUDE.md, INSIGHTS.md,
    and existing modules that use similar patterns. Only ask the user about
    decisions that genuinely cannot be determined from the codebase.

    In particular, resolve these common decisions from the codebase before asking:
    - Module placement (new module vs. extend existing): check the existing
      module list in server/src/modules/index.ts and look for onion-architecture
      precedents. New modules are preferred when the feature has its own DB table,
      LLM call, or distinct business logic.
    - Concurrency strategy: check existing modules (e.g. onboarding) for the
      in-memory lock pattern before asking the user.
    - Multi-agent / parallel execution: propose yes for cross-package features
      unless there is an ordering dependency that prevents it.
    - Cache/persistence strategy: check existing module tables and JSONB patterns
      before asking.

    Write the plan to:
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

    **Step 0 — Enumerate all requirements first.**
    Before auditing, produce a numbered inventory of ALL testable requirements
    from the spec. Include every item from these categories:
      - EARS acceptance criteria (AC-U*, AC-E*, AC-S*, AC-O*, AC-X*) — one entry each
      - Edge cases with a distinct behavioral requirement not already captured
        by an AC (cite from the edge cases table by number)
      - Non-functional requirements with a testable aspect (performance targets,
        security constraints, accessibility rules)
      - Untrusted-input validation rules with distinct behavior

    Label each entry's source: [AC] [EDGE] [NFR] [UNTRUSTED]
    This enumeration is your complete audit checklist — do not add or remove
    items during the audit phase.

    **Documented substitution rule:**
    If the plan's Recommendations section explicitly documents a deliberate
    deviation from the spec's stated mechanism — with a rationale (e.g.,
    "substituting an in-memory mutex for rate limiting because the mutex is
    semantically correct for per-resource exclusivity") — treat that requirement
    as COVERED, not PARTIAL. A documented and justified substitution is an
    implementation decision, not a gap. Only mark as PARTIAL if the substitution
    is undocumented or the rationale is absent.

    **Step 1 — Audit each requirement.**
    For every item in your Step 0 checklist, determine whether the plan covers it.
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

Then classify the result using these counts from the summary:
- `partial_count` = number of PARTIAL requirements
- `missing_count` = number of MISSING requirements
- `flag_count` = number of risk flags

**Also classify each PARTIAL/MISSING gap as:**
- **STRUCTURAL** — an entire step, error path, or architectural decision is absent or wrong; requires planner re-run or significant rewrite
- **TARGETED** — a single value, one-line constraint, or missing note in an existing step; can be fixed with a direct Edit to the plan file

---

### Case A — verdict READY

> "Cross-review passed — all spec requirements are covered by the plan."

Proceed to Final Presentation.

---

### Case B — verdict NEEDS REVISION, partial_count = 0, missing_count = 0 (risk flags only)

No requirement gaps exist. Do NOT offer re-run planner. Present:

> "The cross-review found **N risk flags** but no requirement gaps (0 PARTIAL, 0 MISSING).
> Options:
> 1. **Accept as-is** — risk flags noted for the implementer; proceed to final presentation
> 2. **Targeted edit** — I will add the risk flag notes directly to the plan with Edit tool, then re-run the review
> 3. **Manually fix** — edit the plan directly; tell me when done and I'll re-run"

Handle choice:
- **Accept as-is**: Proceed to Final Presentation.
- **Targeted edit**: Apply Edit tool calls to the plan file for each flag → re-run cross-review (Phase 5).
- **Manually fix**: Wait for user confirmation, read the updated plan, re-run cross-review.

---

### Case C — verdict NEEDS REVISION, all gaps are TARGETED (no STRUCTURAL gaps)

Track internally: `targeted_edit_rounds` = number of targeted-edit passes completed so far.

**If `targeted_edit_rounds` = 0** (first pass):
> "The cross-review found gaps — all are targeted fixes (single values or missing clauses).
> Options:
> 1. **Targeted edit** *(recommended)* — I will apply the fixes directly to the plan with Edit tool, then re-run the review
> 2. **Re-run planner** — full planner re-run with gaps fed back (~100k tokens)
> 3. **Accept as-is** — proceed with current plan, gaps noted for implementation
> 4. **Manually fix** — edit the plan directly; tell me when done"

**If `targeted_edit_rounds` ≥ 1** (same PARTIAL items survived a targeted-edit pass):
> "The cross-review still shows N partial items after the targeted edit — these are
> reviewer judgment calls rather than genuine plan gaps. Recommended: accept as-is.
> Options:
> 1. **Accept as-is** *(recommended)* — surviving partials are documented; proceed to final presentation
> 2. **Targeted edit** — apply another round of edits and re-run the review
> 3. **Manually fix** — edit the plan yourself; tell me when done"

Handle choice:
- **Targeted edit**: Increment `targeted_edit_rounds`. Apply Edit tool calls to the plan file for each gap → re-run cross-review.
- **Re-run planner**: Feed cross-review output and gap list back to implementation-planner (Phase 4 style) → re-run Phase 5.
- **Accept as-is**: Proceed to Final Presentation.
- **Manually fix**: Wait for user confirmation, read the updated plan, re-run cross-review.

---

### Case D — verdict NEEDS REVISION, at least one STRUCTURAL gap

> "The cross-review found structural gaps. Options:
> 1. **Re-run planner** — I will feed the gaps back to implementation-planner and generate a revised plan
> 2. **Accept as-is** — proceed with the current plan (note the gaps for implementation)
> 3. **Manually fix** — edit the plan directly; tell me when done and I will re-run the cross-review"

Handle choice:
- **Re-run planner**: Feed cross-review output and gap list back to implementation-planner (Phase 4 style) → re-run Phase 5.
- **Accept as-is**: Proceed to Final Presentation.
- **Manually fix**: Wait for user confirmation, read the updated plan, re-run cross-review.

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
- Does not use SendMessage to continue spec-creator — always re-spawns with full accumulated Q&A history
