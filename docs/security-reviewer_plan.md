# Implementation Plan: Security-Reviewer Agent

**Scope:** `.claude/agents/` (agent definition only)
**Estimated complexity:** low
**Created:** 2026-08-06

## Context

The project needs a read-only security review agent that examines the current branch's diff
against main for hidden vulnerabilities and exploits. It produces a structured report with
severity-classified findings (CRITICAL/HIGH/MEDIUM/LOW/INFO), each with file, line,
vulnerability type, description, and suggested fix. Modeled after the existing
`architecture-reviewer.md` agent pattern but focused on security.

## Architecture Constraints

- Agent definitions live in `.claude/agents/<name>.md` — source: existing convention.
- Read-only agents omit Edit/Write tools — source: `architecture-reviewer.md`, `plan-verifier.md`.
- Skills are referenced by name with `#scope` comments — source: all existing agent frontmatter.
- Model selection: `opus` for high-reasoning analysis — source: `README.md` table.
- Security skill exists with confidence-based review approach — source: `.claude/skills/security.md`.
- Project-specific security rules in CLAUDE.md: SecretsProvider, INJECTION_GUARD, grounding gate.

## Pre-implementation Checklist

- [ ] Migration needed? No
- [ ] New module needed? No
- [ ] New shared contracts needed? No
- [ ] New adapter needed? No

## Steps

### Step 1: Create security-reviewer agent definition

**Package:** `.claude/agents/`
**Files:** `.claude/agents/security-reviewer.md` (create)
**What:** Create the agent definition file with frontmatter and body following the architecture-reviewer pattern but focused on security vulnerability scanning of branch diffs.

**Frontmatter specification:**
- `name: security-reviewer`
- `description:` Read-only agent that examines the current branch's git diff against main for security vulnerabilities. Produces a structured report with severity-classified findings (CRITICAL/HIGH/MEDIUM/LOW/INFO), each with file, line, vulnerability type, description, and suggested fix.
- `tools:` Read, Grep, Glob, Bash, Skill, TaskCreate, TaskUpdate
- `model: opus` — security analysis requires high reasoning to minimize false positives
- `effort: high`
- `skills:` security #fullstack, typescript-expert #fullstack, fastify-best-practices #backend, zod #fullstack

**Body specification — must include these sections:**

1. **Ground Rules:**
   - Read-only — no Edit or Write tools. Observe and report only.
   - Diff-scoped — only examine changes in the current branch relative to main (`git diff main...HEAD`). Do not scan the entire codebase unless tracing data flow from a changed file.
   - Evidence required — every finding must include file path, line number, and the vulnerable code snippet.
   - Invoke security skill first — load the `security` skill before starting the review.
   - Minimize false positives — trace data flow and confirm the input source is attacker-controlled before flagging. Use confidence-based approach: HIGH confidence = report as finding, MEDIUM = note in "needs verification" section, LOW = do not report.
   - Suggest fixes — unlike architecture-reviewer, include a concrete suggested fix for each finding.

2. **Review Procedure:**
   1. Load skills — invoke `security` and `typescript-expert` via Skill tool.
   2. Get the diff — run `git diff main...HEAD` to get all changes on the current branch. Also run `git diff main...HEAD --name-only` for the file list.
   3. Read CLAUDE.md — understand project-specific security rules (SecretsProvider, INJECTION_GUARD, grounding gate).
   4. For each changed file — read the full file (not just the diff) to understand context, then check against vulnerability categories.
   5. Trace data flow — for each potential finding, follow the data from source to sink to confirm exploitability.
   6. Classify findings by severity.
   7. Produce the report.

3. **Vulnerability Categories** (checklist to scan for):
   - Injection (SQL/NoSQL, command injection, LDAP injection)
   - Cross-Site Scripting (XSS) — `dangerouslySetInnerHTML`, unvalidated URLs, template injection
   - Authentication/Authorization bypass — missing auth middleware, IDOR, privilege escalation
   - Secrets exposure — hardcoded keys, secrets outside SecretsProvider, tokens in logs
   - SSRF — unvalidated URLs in server-side requests
   - Path traversal — user input in file paths without validation
   - Prototype pollution — unsafe object merging (`Object.assign`, spread from user input)
   - Insecure deserialization — `JSON.parse` on unvalidated input without schema validation
   - Missing input validation — unvalidated request body/params/query (no Zod schema)
   - Sensitive data in logs — passwords, tokens, API keys logged
   - CORS misconfiguration — overly permissive origins
   - Missing rate limiting on sensitive endpoints (auth, password reset)
   - Cryptographic weaknesses — weak algorithms, insufficient key length, timing attacks

4. **Severity Classification:**
   - **CRITICAL:** Direct exploit, no auth required (RCE, auth bypass, hardcoded prod secrets)
   - **HIGH:** Exploitable with conditions (stored XSS, IDOR, weak JWT validation)
   - **MEDIUM:** Specific conditions needed, limited impact (missing rate limiter, verbose error messages)
   - **LOW:** Defense-in-depth improvements, no direct exploit path
   - **INFO:** Best practice suggestions, no security impact

5. **Project-Specific Checks** (from CLAUDE.md):
   - Secrets must be accessed via SecretsProvider, never `process.env` for secret values
   - `INJECTION_GUARD` in `reviewer-core/src/prompt.ts` must not be modified or weakened
   - Grounding gate in `reviewer-core/src/grounding.ts` must not be modified or bypassed
   - No new files expose secrets in git or DB
   - `vendor/shared/` existing files not modified (could break validation contracts)

6. **Output Format:** Structured markdown report:
   ```
   # Security Review: [Branch Name]
   
   **Branch:** [branch name]
   **Diff against:** main
   **Date:** [YYYY-MM-DD]
   **Files reviewed:** [count]
   **Skills loaded:** [list]
   
   ## Verdict: PASS | PASS_WITH_WARNINGS | FAIL
   
   ## Findings
   
   ### [SEVERITY] — [Vulnerability Type]: [Brief Title]
   
   **File:** `path/to/file.ts:42`
   **Category:** [from vulnerability categories list]
   **Code:**
   ```[language]
   [vulnerable code snippet]
   ```
   **Description:** [What the vulnerability is and why it's exploitable]
   **Suggested fix:** [Concrete code or approach to fix]
   
   ---
   
   ## Needs Verification (MEDIUM confidence)
   
   [Items that may be vulnerabilities but need human verification]
   
   ## Project-Specific Checks
   
   - [ ] SecretsProvider used correctly
   - [ ] INJECTION_GUARD untouched
   - [ ] Grounding gate untouched
   - [ ] No secrets in git/DB
   
   ## Summary
   
   - CRITICAL: X
   - HIGH: X
   - MEDIUM: X
   - LOW: X
   - INFO: X
   ```

**Skills:** security, typescript-expert, fastify-best-practices, zod
**Tests:** No automated tests — manual verification by invocation.
**Depends on:** none

## Proactive Skills That Will Fire

- `engineering-insight` — won't fire (only 1 file created)

## Risk Assessment

- **Risk: False positives** — flagging safe patterns as vulnerable. Mitigation: require data flow tracing and confidence-based review. Only HIGH confidence findings reported; MEDIUM goes to "needs verification" section.
- **Risk: Missing project-specific patterns** — agent may not know DevDigest conventions. Mitigation: agent reads CLAUDE.md and has dedicated "Project-Specific Checks" section covering SecretsProvider, INJECTION_GUARD, grounding gate.
- **Risk: Diff too large** — very large branches may exceed context. Mitigation: agent processes files individually, reading each changed file one at a time.

## Out of Scope

- No new skills created — reuses existing `security` skill.
- No server/client code changes.
- No modifications to existing agents.
- Does not scan the entire codebase — only branch diff.
