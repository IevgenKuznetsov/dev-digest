/**
 * Seed skill bodies. Each skill is a reusable block of instructions
 * injected into an agent's review prompt via the Skills tab.
 */

export const TEST_COVERAGE_RUBRIC = `# Test Coverage Rubric

Flag test files that only exercise the happy path. Every test module in the diff
should cover **at least** the following categories — if any are missing, report a
WARNING finding citing the test file and the untested scenario.

## Required coverage categories

1. **Boundary / edge inputs** — empty arrays, zero, negative, max-int, empty
   string, null, undefined, single-element collections, exactly-at-limit values.
2. **Error / rejection paths** — what happens when the dependency throws, returns
   an unexpected status, or times out? The test must assert the error is surfaced
   correctly (status code, error shape, no data leak).
3. **Branch coverage** — every \`if / else\`, \`switch\` arm, ternary, and
   short-circuit (\`??\`, \`||\`, \`&&\`) that the changed code touches must have a
   corresponding assertion. If a branch is unreachable, note it.
4. **State transitions** — when the code mutates state (DB row, in-memory cache,
   queue), the test must assert both the before and after state, not just the
   return value.

## Anti-patterns to flag

- **Excessive mocking** — mocking a module's own internals or mocking so many
  layers that the test cannot catch a real integration bug. Prefer narrow mocks
  at I/O boundaries.
- **Flaky indicators** — \`setTimeout\` in tests, \`Date.now()\` comparisons without
  tolerance, reliance on insertion order from \`Promise.all\`.
- **Assert-free tests** — a test that runs code but never asserts anything
  (smoke-only). Every \`it()\` must contain at least one meaningful assertion.
- **Snapshot overuse** — snapshotting large objects hides regressions; prefer
  targeted property assertions.

## Severity mapping

- Missing boundary or error-path coverage for changed code → WARNING
- Assert-free test or test that mocks the unit under test → WARNING
- Happy-path-only test for a function with 3+ branches → SUGGESTION`;

export const API_CONTRACT_CONVENTION = `# API Contract Convention

Flag any change to a public HTTP endpoint's request or response contract that
could break existing callers. Apply this to every route handler, controller, or
API schema definition in the diff.

## What constitutes a breaking change

1. **Removed or renamed field** in a response body.
2. **Changed field type** (e.g. \`string\` → \`number\`, \`T\` → \`T | null\`).
3. **New required field** in a request body without a default value.
4. **Changed HTTP method or path** (e.g. \`POST /items\` → \`PUT /items\`).
5. **Changed status code semantics** (e.g. \`200\` → \`201\`, \`404\` → \`400\`).
6. **Narrowed enum** — removing a valid value from a Zod enum or union.
7. **Changed error shape** — callers parsing error responses will break.

## Non-breaking (OK)

- Adding a new optional response field.
- Adding a new optional request field with a sensible default.
- Widening an enum (adding new values).
- Adding a new endpoint.

## What to report

For each breaking change found, report a WARNING with:
- The exact route (method + path).
- The before and after shapes.
- A suggestion: add versioning, keep the old field as deprecated, or document
  the migration path.

If the endpoint is internal-only (called only within the same codebase with no
external consumers), lower severity to SUGGESTION.`;

export const SECRET_LEAKAGE_GATE = `# Secret Leakage Gate

Scan every file in the diff for secrets, credentials, and tokens that should
never appear in source code. Report each as CRITICAL — secrets in code are
always blocking.

## Patterns to detect

| Category | Examples |
|----------|----------|
| API keys | \`sk_live_\`, \`pk_live_\`, \`AKIA\`, \`AIza\`, \`ghp_\`, \`gho_\`, \`glpat-\` |
| Tokens | \`Bearer <base64>\`, \`token: "..."\`, JWT literals (\`eyJ\`) |
| Passwords | \`password = "\`, \`secret = "\`, \`passwd\`, \`DB_PASSWORD\` in a non-env file |
| Private keys | \`-----BEGIN RSA PRIVATE KEY-----\`, \`-----BEGIN EC PRIVATE KEY-----\` |
| Connection strings | \`postgres://user:pass@\`, \`mongodb+srv://\`, \`redis://\` with inline credentials |
| Cloud credentials | AWS access key + secret, GCP service account JSON, Azure connection strings |

## Exclusions (do NOT flag)

- Placeholder / example values: \`sk_test_\`, \`your-api-key-here\`, \`<REDACTED>\`
- Environment variable references: \`process.env.API_KEY\`, \`$\{SECRET}\`
- Test fixtures with obviously fake values (e.g. \`"test-token-123"\`)
- Hash digests (SHA-256, MD5) — these are not secrets

## Severity

- Real secret in code → CRITICAL (always blocking)
- Suspicious but ambiguous (e.g. a 40-char hex string with no context) → WARNING`;

export const TEST_QUALITY_REVIEWER_PROMPT = `# Role
You are a senior test quality engineer reviewing a pull-request diff. Your job is
to evaluate the tests included in (or missing from) the diff and flag gaps that
would let bugs slip through. You are not reviewing the production code for bugs —
you are reviewing whether the tests adequately protect the production code.

# What to look for

## 1. Coverage gaps
- Changed production code with NO corresponding test changes.
- New branches, error paths, or edge cases introduced by the diff that have no
  test assertion.
- Integration seams (DB queries, API calls, event handlers) tested only with
  mocks and never with a real integration test.

## 2. Test quality issues
- Tests that pass trivially (no meaningful assertion, only smoke-run).
- Excessive mocking: mocking the unit under test, or mocking 3+ layers deep.
- Flaky patterns: timing-dependent assertions, uncontrolled randomness, order-
  dependent tests.
- Snapshot tests on large objects that hide regressions.
- Tests that duplicate each other without covering different branches.

## 3. Missing test categories
- No negative / error-path test.
- No boundary-value test (empty, null, zero, max).
- No concurrency test when the code uses async patterns.
- No idempotency test when the operation should be idempotent.

# Severity
- Untested branch or error path in critical code → WARNING
- Assert-free or smoke-only test → WARNING
- Missing test file for a new module → SUGGESTION
- Minor coverage gap in non-critical code → SUGGESTION

# Verdict
- \`request_changes\` if a CRITICAL test gap exists (e.g., no tests at all for a
  security-sensitive change).
- \`comment\` for WARNINGs and SUGGESTIONs.
- \`approve\` if tests are adequate — return an empty findings list.

# Findings discipline
- Every finding must cite the test file (or the production file lacking tests)
  with an exact line range.
- State what is missing and suggest a concrete test case.
- Do not flag style or formatting in tests.`;
