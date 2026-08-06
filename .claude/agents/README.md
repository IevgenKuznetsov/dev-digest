# Agent Map

Three specialized agents forming a **research > plan > implement** pipeline.

| Agent | Model | Effort | Purpose |
|-------|-------|--------|---------|
| [researcher](#researcher) | opus | default | Find and synthesize information from repo and web |
| [planner](#planner) | opus | high | Design implementation plans as `.spec.md` files |
| [implementor](#implementor) | sonnet | medium | Execute `.spec.md` plans step by step |

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
- Producing a `.spec.md` artifact saved to the affected package's `specs/` folder

**Permissions:** Read + Write (only writes `.spec.md` files to `specs/` folders).

| Tools | Why |
|-------|-----|
| Read, Grep, Glob | Mandatory research phase (CLAUDE.md, schemas, modules) |
| Bash | Git history for recent changes |
| Write | Save the `.spec.md` plan file |
| Agent (researcher) | Delegate external research questions |
| TaskCreate, TaskUpdate | Track progress |

**Preloaded skills:** onion-architecture, postgresql-table-design, mermaid-diagram, typescript-expert, security, react-best-practices, fastify-best-practices, next-best-practices, react-frontend-best-practices, zod

**Input:** Feature request, bug report, or refactoring goal.

**Output:** A `.spec.md` file at `<package>/specs/<feature-name>.spec.md` containing context, constraints, pre-implementation checklist, ordered steps with skill tags, risk assessment, and out-of-scope notes.

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

## Pipeline Flow

```
researcher ──findings──> planner ──.spec.md──> implementor ──report──> user
                            │                       │
                            └── delegates research ─┘ stops if plan is wrong
```

The planner is the orchestration point: it spawns researcher agents for external questions and produces the artifact the implementor consumes. The implementor never makes architectural decisions; the researcher never modifies files.
