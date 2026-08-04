---
name: pr-self-review
description: "Proactively reviews every git commit for architecture and best-practice violations. TRIGGER: automatically invoke this skill immediately after any files are committed to git (post-commit). Analyzes the committed diff, checks client-side changes against react-frontend-best-practices, checks server-side changes against onion-architecture, lists all found issues with severity, and blocks merge when any CRITICAL issue is found. Does NOT wait for the user to ask."
disable-model-invocation: true
metadata:
  author: ievgen.kuznetsov@gmail.com
  version: 1.0.0
---

# PR Self-Review

Automated post-commit review gate. Runs after every `git commit` to catch architecture and best-practice violations before they reach a PR.

## When to Activate

**Every time files are committed to git.** This is not optional — invoke automatically after each commit completes.

## Procedure

### 1. Collect the Diff

Get the diff for the most recent commit:

```bash
git diff HEAD~1..HEAD
```

If this is the first commit on the branch, diff against the base branch instead:

```bash
git merge-base main HEAD
git diff <merge-base>..HEAD
```

### 2. Classify Changed Files

Partition the changed files into two groups:

| Group | Path patterns | Review skill |
|-------|--------------|--------------|
| **Client** | `client/src/**`, any `.tsx`, `.jsx`, Next.js app routes | `react-frontend-best-practices` |
| **Server** | `server/src/modules/**`, `server/src/platform/**`, `server/src/adapters/**` | `onion-architecture` |

Files outside both groups (configs, scripts, docs, tests-only changes) get a lightweight check — no deep skill review, but still flag obvious issues.

### 3. Review Client-Side Changes

For every file in the **Client** group, apply the `react-frontend-best-practices` skill rules:

- **Component location** — Is the component in the correct tier (`_components/`, `components/`, `vendor/ui/`)?
- **Constants** — Are there magic values that should be extracted?
- **Helpers** — Are helpers pure? Are they colocated correctly?
- **Business logic boundaries** — Are TanStack Query hooks used as the data layer? Are pages kept as orchestrators?
- **Module boundaries** — Does the dependency direction hold (`app/ → components/ → lib/ → vendor/`)?
- **Promotion** — Is anything prematurely promoted to `components/` with only one consumer?

Also apply `react-best-practices` rules for code quality:

- Derived state stored in `useState` (CRITICAL)
- Render factories returning JSX as camelCase functions (CRITICAL)
- `useEffect` misuse — derived state, event handling, chained effects
- Key prop violations (index keys on dynamic lists)
- Conditional rendering with falsy `0`

### 4. Review Server-Side Changes

For every file in the **Server** group, apply the `onion-architecture` skill rules:

- **Dependency rule** — Do dependencies point inward only? Does an inner layer import from an outer layer?
- **Domain layer purity** — Does the domain layer have zero external dependencies (no Drizzle, no Fastify, no npm packages)?
- **Layer responsibilities** — Is each file in the correct layer for its responsibility?
  - Routes in presentation, use cases in application, repos in infrastructure, entities in domain
- **Anti-patterns** — Check for common violations:
  - Service importing from routes
  - Domain importing from Drizzle schema
  - Repository containing business logic
  - Route handler with inline SQL/ORM queries
  - Fat controllers (route handlers doing orchestration instead of delegating to service)
- **DI via composition root** — Are concrete implementations wired in `platform/container.ts`, not hardcoded in services?

### 5. Compile the Report

Output a structured report with this exact format:

```
## PR Self-Review — commit <short-hash>

### Client Issues
| # | Severity | File | Line | Rule | Description |
|---|----------|------|------|------|-------------|
| 1 | CRITICAL | ... | ... | ... | ... |

### Server Issues
| # | Severity | File | Line | Rule | Description |
|---|----------|------|------|------|-------------|
| 1 | HIGH | ... | ... | ... | ... |

### Summary
- Critical: N
- High: N
- Medium: N
- **Verdict: PASS / BLOCK**
```

### 6. Block or Pass

| Condition | Verdict | Action |
|-----------|---------|--------|
| 0 critical issues | **PASS** | Print summary, continue |
| ≥1 critical issue | **BLOCK** | Print full report, list each critical issue with fix guidance, instruct user to fix before merging |

When blocking:

1. Print the full report
2. For each CRITICAL issue, provide:
   - The exact file and line
   - What rule is violated
   - A concrete fix suggestion (code snippet when possible)
3. End with: **"⛔ BLOCKED — N critical issue(s) must be resolved before merge."**

When passing with non-critical issues:

1. Print the summary table
2. List HIGH issues briefly (one line each)
3. End with: **"✅ PASS — no critical issues. N non-critical issue(s) noted above."**

When passing with zero issues:

1. End with: **"✅ PASS — no issues found."**

## Severity Levels

Inherit severity from the source skills:

| Severity | Meaning | Source |
|----------|---------|--------|
| **CRITICAL** | Bugs, broken reconciliation, dependency rule violations, wrong layer placement | react-best-practices, onion-architecture dependency-rule |
| **HIGH** | Performance issues, scaling problems, layer responsibility violations | react-best-practices, onion-architecture anti-patterns |
| **MEDIUM** | Maintainability, developer experience, discoverability | react-frontend-best-practices, onion-architecture module-structure |

## What NOT to Flag

- Test files (`*.test.ts`, `*.test.tsx`, `*.it.test.ts`) — unless they import from wrong layers
- Config files (`.env`, `tsconfig.json`, `vite.config.ts`) — unless they expose secrets
- Documentation changes (`*.md`)
- Files in `vendor/` — these are read-only upstream; flag only if someone edited an existing vendor file
- Stylistic preferences that don't match a specific rule from the source skills
