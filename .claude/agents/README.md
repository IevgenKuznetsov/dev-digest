# Agent Map

Nine specialized agents: a core **research → plan → implement** pipeline plus quality, orchestration, and support agents.

| Agent | Model | Effort | Purpose |
|-------|-------|--------|---------|
| [researcher](#researcher) | sonnet | medium | Find and synthesize information from repo and web |
| [planner](#planner) | opus | high | Design implementation plans → `docs/<Feature>_plan.md` |
| [brainstorm](#brainstorm) | sonnet | medium | Spawn N planners in parallel, compare approaches with pros/cons |
| [implementor](#implementor) | sonnet | medium | Execute `.spec.md` plans step by step |
| [test-writer](#test-writer) | sonnet | medium | Write unit and integration tests |
| [architecture-reviewer](#architecture-reviewer) | sonnet | medium | READ-ONLY check of architecture boundaries per module |
| [security-reviewer](#security-reviewer) | sonnet | medium | READ-ONLY security scan of branch diff with severity report |
| [plan-verifier](#plan-verifier) | sonnet | medium | READ-ONLY point-by-point verification of plan vs implementation |
| [doc-writer](#doc-writer) | sonnet | medium | Write documentation with Mermaid diagrams |

---

## researcher

**Purpose:** Finds, verifies, and synthesizes information from the local repository and external sources (web, documentation, APIs).

**Responsibilities:**
- Codebase exploration (file patterns, code search, git history)
- External research (docs, blogs, RFCs, GitHub issues)
- Cross-referencing findings across multiple sources
- Producing cited, structured research reports

**Permissions:** Read-only. Cannot modify files.

| Tools | Why |
|-------|-----|
| Glob, Grep, Read | Codebase search and file reading |
| Bash | Git log/blame/diff (read-only shell) |
| WebSearch, WebFetch | External research |
| Agent (Explore) | Delegate broad codebase exploration |
| AskUserQuestion | Clarify ambiguous requests before searching |
| TaskCreate, TaskUpdate | Track progress |

**Input:** A research question or topic with scope boundaries.

**Output:** Structured research report in one of three formats:
- Repository Research (file paths + line numbers as citations)
- External Research (URLs as citations, confidence levels per finding)
- Combined Research (both above + synthesis section)

---

## planner

**Purpose:** Designs step-by-step implementation plans that the implementor agent can execute without ambiguity.

**Responsibilities:**
- Reading all relevant CLAUDE.md, INSIGHTS.md, and existing code before planning
- Verifying architecture constraints against project rules
- Tagging each step with skills the implementor should invoke
- Delegating external research to the researcher agent (never searches the web directly)
- Saving the approved plan to `docs/<FeatureName>_plan.md` — the ONLY file it may create

**Permissions:** Read + Write (restricted to `docs/*_plan.md` only). No other file creation or editing.

| Tools | Why |
|-------|-----|
| Read, Grep, Glob | Mandatory research phase (CLAUDE.md, schemas, modules) |
| Bash | Git history for recent changes |
| Write | Save approved plan to `docs/<FeatureName>_plan.md` — the only allowed file |
| Agent (researcher) | Delegate external research questions |
| AskUserQuestion | Ask user to review the plan before saving |
| TaskCreate, TaskUpdate | Track progress |

**Preloaded skills:** onion-architecture, postgresql-table-design, mermaid-diagram, typescript-expert, security, react-best-practices, fastify-best-practices, next-best-practices, react-frontend-best-practices, zod

**Input:** Feature request, bug report, or refactoring goal.

**Output:** Plan presented to user for review, then saved to `docs/<FeatureName>_plan.md` after approval. Contains context, constraints, pre-implementation checklist, ordered steps with skill tags, risk assessment, and out-of-scope notes.

---

## brainstorm

**Purpose:** Multi-planner orchestrator that spawns N planner agents in parallel to generate independent solutions for the same problem, then compares all approaches with pros and cons.

**Responsibilities:**
- Clarifying the problem statement and desired number of parallel planners (default 3)
- Crafting diverse planner prompts (simplicity, extensibility, minimal changes)
- Spawning all planner agents concurrently via Agent tool
- Analyzing and comparing returned plans across 6 criteria
- Producing a structured comparison report with summary table, detailed pros/cons, idea combinations, and recommendation

**Permissions:** Read-only. Cannot modify files. Does not create plan files — delegates to planner sub-agents.

| Tools | Why |
|-------|-----|
| Read, Grep, Glob | Understand codebase context for comparison |
| Bash | Git history for context |
| Agent (planner) | Spawn parallel planner sub-agents |
| AskUserQuestion | Confirm problem scope and planner count |
| TaskCreate, TaskUpdate | Track progress |

**Input:** A problem, feature request, or refactoring goal + optional planner count (default 3).

**Output:** Structured comparison report with:
- Summary table rating each plan across scope, architecture fit, risk, testability, extensibility, simplicity
- Detailed advantages/disadvantages for each plan
- Combinable ideas across plans
- Recommendation (user makes final decision)

---

## implementor

**Purpose:** Executes `.spec.md` plans by writing production code and tests, following each step in order.

**Responsibilities:**
- Reading and following the spec file as source of truth
- Invoking tagged skills before writing code for each step
- Running relevant tests after each step
- Stopping and reporting back if the plan is wrong or incomplete (no improvising)
- Enforcing CLAUDE.md compliance (vendor/shared, INJECTION_GUARD, module registration, etc.)

**Permissions:** Full read/write access to code and tests. No architecture or security review.

| Tools | Why |
|-------|-----|
| Read, Grep, Glob | Understand existing code before modifying |
| Edit, Write | Implement changes |
| Bash | Run tests, type checks, shell commands |
| Skill, ToolSearch | Invoke tagged skills before coding |
| NotebookEdit | Jupyter notebook modifications if needed |
| TaskCreate, TaskUpdate | Track step completion |

**Preloaded skills:** typescript-expert, security, postgresql-table-design, mermaid-diagram, react-best-practices, fastify-best-practices, next-best-practices, react-frontend-best-practices, zod

**Input:** Path to a `.spec.md` plan file.

**Output:** Implementation report listing completed steps, files changed, skills applied, test results, deviations, and remaining work.

---

## test-writer

**Purpose:** Writes tests for UI (React/Next.js) and backend (Fastify/Drizzle) code.

**Responsibilities:**
- Reading source code and existing tests before writing
- Invoking testing skills (react-testing-library, fastify-best-practices) before writing
- Following test conventions: `*.test.ts` for unit, `*.it.test.ts` for integration
- Using mocks from `server/src/adapters/mocks.ts` for server unit tests
- Running tests after writing to verify they pass

**Permissions:** Read/write for test files only. No production code.

| Tools | Why |
|-------|-----|
| Read, Grep, Glob | Understand code under test and existing test patterns |
| Edit, Write | Create and modify test files |
| Bash | Run tests after writing |
| Skill, ToolSearch | Invoke testing skills before writing |
| TaskCreate, TaskUpdate | Track progress |

**Preloaded skills:** react-testing-library, react-best-practices, react-frontend-best-practices, fastify-best-practices, drizzle-orm-patterns, zod, typescript-expert

**Input:** File path, module name, or `.spec.md` plan with test requirements.

**Output:** Test files + test run results summary.

---

## architecture-reviewer

**Purpose:** Read-only agent that checks architecture boundaries for a specific module on demand.

**Responsibilities:**
- Checking onion architecture layer violations (domain → application → infrastructure)
- Validating module isolation (no cross-module internal imports)
- Verifying CLAUDE.md "Do not touch" rules (vendor/shared, INJECTION_GUARD, grounding gate)
- Checking secrets handling (SecretsProvider only)
- Providing evidence for every finding (file:line + code snippet)

**Permissions:** Read-only. Cannot modify files.

| Tools | Why |
|-------|-----|
| Read, Grep, Glob | Search for violations and read code |
| Bash | Git diff/log/blame for change analysis |
| Skill | Load onion-architecture and other review skills |
| TaskCreate, TaskUpdate | Track progress |

**Preloaded skills:** onion-architecture, react-frontend-best-practices, typescript-expert, security, fastify-best-practices, zod

**Input:** A specific module to review (e.g., "reviews module", "server/src/modules/agents").

**Output:** Structured report with severity-classified findings, each with file:line evidence and rule source citation.

---

## security-reviewer

**Purpose:** Read-only agent that examines the current branch's git diff against main for security vulnerabilities with severity-classified findings.

**Responsibilities:**
- Loading the `security` skill before scanning
- Analyzing `git diff main...HEAD` for vulnerabilities across 13 categories
- Tracing data flow from source to sink to confirm exploitability (minimizing false positives)
- Checking project-specific security rules (SecretsProvider, INJECTION_GUARD, grounding gate)
- Classifying findings by severity (CRITICAL/HIGH/MEDIUM/LOW/INFO)
- Providing concrete suggested fixes for each finding

**Permissions:** Read-only. Cannot modify files.

| Tools | Why |
|-------|-----|
| Read, Grep, Glob | Read changed files and trace data flow |
| Bash | Git diff/log for branch changes |
| Skill | Load security, typescript-expert, and other review skills |
| TaskCreate, TaskUpdate | Track progress |

**Preloaded skills:** security, typescript-expert, fastify-best-practices, zod

**Input:** Runs on the current branch — no explicit input needed (uses `git diff main...HEAD`).

**Output:** Structured security report with:
- Verdict (PASS / PASS_WITH_WARNINGS / FAIL)
- Findings ordered by severity with file:line, code snippet, description, and suggested fix
- "Needs Verification" section for medium-confidence items
- Project-specific checks (SecretsProvider, INJECTION_GUARD, grounding gate, secrets in git/DB, vendor/shared)
- Summary counts by severity

---

## plan-verifier

**Purpose:** Compares implemented code against ALL points of a plan — point by point, with evidence.

**Responsibilities:**
- Parsing every step, sub-point, and constraint from the plan
- Verifying each item individually with PASS/FAIL/PARTIAL + file:line evidence
- Checking for scope creep (files changed outside the plan)
- Checking out-of-scope violations
- Never giving general advice or "looks good" summaries

**Permissions:** Read-only. Cannot modify files.

| Tools | Why |
|-------|-----|
| Read, Grep, Glob | Read plan and verify implementation |
| Bash | Git diff to see what changed |
| TaskCreate, TaskUpdate | Track checklist progress |

**Input:** Spec file path OR pasted plan text, optionally with a git range.

**Output:** Point-by-point verification table with PASS/FAIL/PARTIAL status and evidence for every requirement.

---

## doc-writer

**Purpose:** Writes documentation for implemented features with Mermaid diagrams.

**Responsibilities:**
- Reading actual implementation code (not just plans) before documenting
- Creating docs in `<package>/docs/<FeatureName>/` directories
- Including Mermaid diagrams (flowcharts, sequence diagrams, ER diagrams, state diagrams)
- Updating existing docs rather than creating duplicates
- Never creating CLAUDE.md, INSIGHTS.md, or .spec.md files

**Permissions:** Read/write for documentation files only.

| Tools | Why |
|-------|-----|
| Read, Grep, Glob | Understand code being documented |
| Edit, Write | Create/modify documentation files |
| Bash | Git log for recent changes |
| Skill, ToolSearch | Invoke mermaid-diagram before creating diagrams |
| TaskCreate, TaskUpdate | Track progress |

**Preloaded skills:** mermaid-diagram, onion-architecture, react-frontend-best-practices, typescript-expert, fastify-best-practices, next-best-practices

**Input:** Feature description, module name, or `.spec.md` plan.

**Output:** Documentation files in `<package>/docs/<FeatureName>/` + report of what was written.

---

## Pipeline Flow

```
Optimized pipeline:   planner (self-explores) ──plan──> implementor ──report──> user
                                                  │                    │
                                                  └── delegates ───────┘ stops if plan is wrong

Optional research:    planner ──delegates──> researcher (only for genuinely unknown domains)

Orchestration:        brainstorm ──spawns N──> planner (×N) ──plans──> brainstorm ──comparison──> user

Quality gates:        architecture-reviewer ──findings──> user     (sonnet, compact output)
                      security-reviewer ──findings──> user         (sonnet, compact output)
                      plan-verifier ──checklist──> user             (sonnet, compact output)

Support:              test-writer ──test files──> test results
                      doc-writer ──docs──> user
```

The planner explores the codebase directly (no separate Explore agent needed) and presents
plans as text for user review. Researcher is only spawned for genuinely unknown domains.
The implementor executes approved plans. Quality gates (architecture-reviewer, security-reviewer,
plan-verifier) run on sonnet with compact output (under 2000 words each) to minimize token
usage. Support agents (test-writer, doc-writer) produce artifacts independently.

**Token optimization:** Only planner and implementor use opus-class models. All reviewers,
researcher, and brainstorm use sonnet with medium effort. Output caps prevent verbose reports.
