import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType, SkillSource } from '@devdigest/shared';
import { eq, and, inArray, isNotNull, sql, count } from 'drizzle-orm';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import { assertNoInjection, toRawUrl } from './helpers.js';
import * as t from '../../db/schema.js';

/**
 * A1 — skills module.
 *   GET    /skills                            → list (workspace-scoped)
 *   GET    /skills/:id                        → one skill
 *   POST   /skills                            → create
 *   PUT    /skills/:id                        → update
 *   DELETE /skills/:id                        → delete
 *   GET    /skills/:id/versions               → version history
 *   POST   /skills/:id/versions/:ver/restore  → restore body from past version
 *   GET    /skills/:id/eval-cases             → eval cases for this skill
 *   POST   /skills/import/preview             → parse markdown, return preview (no persist)
 *   POST   /skills/import/confirm             → persist previewed skill
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType,
  source: SkillSource.optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

const ImportPreviewBody = z.object({
  body: z.string().min(1),
  name: z.string().optional(),
});

const ImportConfirmBody = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType,
  source: SkillSource.optional(),
  body: z.string().min(1),
});

const ImportFromUrlBody = z.object({
  url: z.string().url(),
  name: z.string().optional(),
});

const CommunitySearchQuery = z.object({
  q: z.string().optional(),
  lang: z.string().optional(),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    return reply.status(201).send(skill);
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const deleted = await service.delete(workspaceId, req.params.id);
    if (!deleted) throw new NotFoundError('Skill not found');
    return reply.status(204).send();
  });

  // ---- Versions ----

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return service.listVersions(req.params.id);
  });

  const VersionParams = z.object({ id: z.string().uuid(), ver: z.coerce.number().int().positive() });

  app.post('/skills/:id/versions/:ver/restore', { schema: { params: VersionParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.restoreVersion(workspaceId, req.params.id, req.params.ver);
    if (!skill) throw new NotFoundError('Skill or version not found');
    return skill;
  });

  // ---- Eval cases (read-only for now — eval module will own mutations) ----

  app.get('/skills/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    const cases = await app.container.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerId, req.params.id), eq(t.evalCases.ownerKind, 'skill')));
    return cases.map((c) => ({
      id: c.id,
      name: c.name,
      notes: c.notes,
    }));
  });

  // ---- Stats ----

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');

    const db = app.container.db;

    // Agents using this skill
    const agentLinks = await db
      .select({ agentId: t.agentSkills.agentId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, req.params.id));

    const agentIds = agentLinks.map((l) => l.agentId);

    const agentNames: Array<{ id: string; name: string }> = agentIds.length
      ? await db
          .select({ id: t.agents.id, name: t.agents.name })
          .from(t.agents)
          .where(inArray(t.agents.id, agentIds))
      : [];

    // If no agents use this skill, return zeros
    if (agentIds.length === 0) {
      return {
        used_by_agents: [],
        agents_count: 0,
        pull_frequency: null,
        accept_rate: null,
        findings_total: 0,
        findings_by_category: {},
      };
    }

    // Total PRs in workspace (denominator for pull frequency)
    const [prCount] = await db
      .select({ n: count() })
      .from(t.pullRequests)
      .where(eq(t.pullRequests.workspaceId, workspaceId));

    // Runs by these agents
    const runs = await db
      .select({ id: t.agentRuns.id, prId: t.agentRuns.prId })
      .from(t.agentRuns)
      .where(inArray(t.agentRuns.agentId, agentIds));

    // Pull frequency = distinct PRs reviewed / total PRs
    const reviewedPrIds = new Set(runs.map((r) => r.prId).filter(Boolean));
    const totalPrs = prCount?.n ?? 0;
    const pullFrequency =
      totalPrs > 0 ? Math.round((reviewedPrIds.size / totalPrs) * 100) : null;

    // Findings from reviews produced by these agents' runs
    const runIds = runs.map((r) => r.id);
    let findingsTotal = 0;
    let accepted = 0;
    let actioned = 0; // accepted + dismissed
    const byCat: Record<string, number> = {};

    if (runIds.length > 0) {
      // Get review IDs for these runs
      const reviewRows = await db
        .select({ id: t.reviews.id })
        .from(t.reviews)
        .where(inArray(t.reviews.runId, runIds));

      const reviewIds = reviewRows.map((r) => r.id);

      if (reviewIds.length > 0) {
        const allFindings = await db
          .select({
            category: t.findings.category,
            acceptedAt: t.findings.acceptedAt,
            dismissedAt: t.findings.dismissedAt,
          })
          .from(t.findings)
          .where(inArray(t.findings.reviewId, reviewIds));

        findingsTotal = allFindings.length;
        for (const f of allFindings) {
          byCat[f.category] = (byCat[f.category] ?? 0) + 1;
          if (f.acceptedAt) { accepted++; actioned++; }
          else if (f.dismissedAt) { actioned++; }
        }
      }
    }

    const acceptRate = actioned > 0 ? Math.round((accepted / actioned) * 100) : null;

    return {
      used_by_agents: agentNames,
      agents_count: agentNames.length,
      pull_frequency: pullFrequency,
      accept_rate: acceptRate,
      findings_total: findingsTotal,
      findings_by_category: byCat,
    };
  });

  // ---- Import ----

  app.post(
    '/skills/import/preview',
    { schema: { body: ImportPreviewBody } },
    async (req) => {
      return service.importPreview(req.body.body, req.body.name);
    },
  );

  app.post(
    '/skills/import/confirm',
    { schema: { body: ImportConfirmBody } },
    async (req, reply) => {
      assertNoInjection(req.body.body);
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.importConfirm(workspaceId, req.body);
      return reply.status(201).send(skill);
    },
  );

  // ---- Import from URL ----

  /** Shared helper: fetch URL content with raw-URL normalization. */
  async function fetchSkillFromUrl(url: string, nameOverride?: string) {
    const rawUrl = toRawUrl(url);
    const res = await fetch(rawUrl);
    if (!res.ok) throw new NotFoundError(`Failed to fetch URL: ${res.status}`);
    const markdown = await res.text();
    assertNoInjection(markdown);
    return service.importPreview(markdown, nameOverride);
  }

  app.post(
    '/skills/import/url/preview',
    { schema: { body: ImportFromUrlBody } },
    async (req) => {
      return fetchSkillFromUrl(req.body.url, req.body.name);
    },
  );

  app.post(
    '/skills/import/url',
    { schema: { body: ImportFromUrlBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const preview = await fetchSkillFromUrl(req.body.url, req.body.name);
      const skill = await service.importConfirm(workspaceId, {
        name: preview.name,
        description: preview.description,
        type: preview.type,
        source: 'imported_url',
        body: preview.body,
        enabled: false, // disabled until vetted
      });
      return reply.status(201).send(skill);
    },
  );

  // ---- Community skills catalog ----

  app.get(
    '/skills/community/search',
    { schema: { querystring: CommunitySearchQuery } },
    async (req) => {
      const q = (req.query.q ?? '').toLowerCase();
      const lang = (req.query.lang ?? '').toLowerCase();
      let results = COMMUNITY_CATALOG;
      if (q) results = results.filter((s) => s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q));
      if (lang && lang !== 'all') results = results.filter((s) => s.lang.toLowerCase() === lang);
      return results;
    },
  );
}

/* Static community skills catalog — curated, vetted skills from public repos.
   Each entry includes the full SKILL.md body so imports get real content. */
const COMMUNITY_CATALOG = [
  {
    name: 'owasp-top-10-review',
    desc: 'Maps diff changes to the OWASP Top 10 with CWE references.',
    repo: 'secdev/agent-skills',
    stars: 1240,
    lang: 'any',
    body: `# OWASP Top 10 Review

## Purpose
Flag code changes that introduce vulnerabilities listed in the OWASP Top 10 (2021 edition). Each finding must reference the relevant CWE identifier.

## Rules
1. **A01 — Broken Access Control (CWE-284):** Flag missing authorization checks on endpoints that mutate state or return sensitive data.
2. **A02 — Cryptographic Failures (CWE-327):** Flag use of weak hashing (MD5, SHA-1 for secrets), hardcoded keys, or missing TLS enforcement.
3. **A03 — Injection (CWE-89, CWE-79):** Flag string-concatenated SQL, unsanitized HTML interpolation, and OS command construction from user input.
4. **A04 — Insecure Design (CWE-840):** Flag missing rate-limiting on authentication endpoints, absence of CSRF tokens on state-changing forms.
5. **A05 — Security Misconfiguration (CWE-16):** Flag overly permissive CORS, debug mode in production configs, default credentials.
6. **A06 — Vulnerable Components (CWE-1104):** Flag imports of packages with known CVEs when a safer alternative exists.
7. **A07 — Auth Failures (CWE-287):** Flag weak password policies, missing MFA enforcement, session tokens in URLs.
8. **A08 — Data Integrity (CWE-502):** Flag deserialization of untrusted data without validation, missing integrity checks on CI artifacts.
9. **A09 — Logging Failures (CWE-778):** Flag sensitive data (tokens, PII) written to logs, missing audit trails on admin actions.
10. **A10 — SSRF (CWE-918):** Flag user-controlled URLs passed to server-side fetch/request without allowlist validation.

## Severity mapping
- Direct exploit path → CRITICAL
- Requires additional conditions → WARNING
- Informational / defense-in-depth → SUGGESTION`,
  },
  {
    name: 'react-hooks-rules',
    desc: 'Detects conditional hooks, missing deps, stale closures.',
    repo: 'frontend-guild/skills',
    stars: 842,
    lang: 'TypeScript',
    body: `# React Hooks Rules

## Purpose
Enforce the Rules of Hooks and catch common hook misuse patterns that lead to bugs, stale state, or infinite re-renders.

## Rules
1. **No conditional hooks:** Hooks must not be called inside if/else, loops, or after early returns. React relies on stable call order between renders.
2. **Exhaustive deps:** Every variable referenced inside useEffect / useMemo / useCallback must appear in the dependency array, or be explicitly excluded with a comment explaining why.
3. **Stale closure detection:** Flag effects or callbacks that capture a ref's \`.current\` in the closure body but omit it from deps — the value will be stale on subsequent renders.
4. **No hooks in event handlers:** Hooks called inside onClick, onSubmit, or other event handlers are illegal — they execute outside the render cycle.
5. **Custom hook naming:** Functions that call hooks internally must start with \`use\` (e.g., \`useAuth\`, not \`getAuth\`), so the linter can enforce rules transitively.
6. **Avoid object/array literals in deps:** Inline \`{}\` or \`[]\` in dependency arrays trigger effects on every render. Hoist to module scope or wrap in useMemo.
7. **useEffect cleanup:** Effects that subscribe to events, set timers, or open connections must return a cleanup function to prevent memory leaks.

## Severity mapping
- Conditional hooks / hooks in callbacks → CRITICAL (runtime crash)
- Missing deps with mutation risk → WARNING
- Style / naming violations → SUGGESTION`,
  },
  {
    name: 'sql-injection-gate',
    desc: 'Flags string-concatenated SQL and unparameterized queries.',
    repo: 'secdev/agent-skills',
    stars: 690,
    lang: 'any',
    body: `# SQL Injection Gate

## Purpose
Prevent SQL injection vulnerabilities by detecting unsafe query construction patterns.

## Rules
1. **String concatenation in queries:** Flag any SQL string built with \`+\`, template literals, or \`format()\` that interpolates user-supplied values.
2. **Raw query APIs without params:** Flag calls to \`db.raw()\`, \`sequelize.query()\`, \`knex.raw()\`, or \`pool.query()\` where the SQL string contains interpolated variables instead of parameterized placeholders (\`$1\`, \`?\`).
3. **ORM bypass patterns:** Flag \`.whereRaw()\`, \`.havingRaw()\`, or similar escape-hatch methods when the argument includes non-constant expressions.
4. **Dynamic table/column names:** Flag table or column names constructed from user input — these cannot be parameterized and must be validated against an allowlist.
5. **Stored procedure calls:** Flag EXEC / CALL statements where arguments are concatenated rather than passed as parameters.

## Exceptions
- Migrations and seed files are excluded (no user input at that stage).
- Constants and enums used in query construction are safe.

## Severity mapping
- Direct user input in SQL string → CRITICAL
- Indirect input (req.body field passed through) → WARNING
- Raw query with only constants → SUGGESTION`,
  },
  {
    name: 'a11y-jsx-audit',
    desc: 'Checks JSX for missing alt, ARIA, and focus traps.',
    repo: 'a11y-collective/skills',
    stars: 318,
    lang: 'TypeScript',
    body: `# Accessibility JSX Audit

## Purpose
Ensure JSX components meet WCAG 2.1 AA accessibility standards. Focus on programmatic issues that automated linters miss.

## Rules
1. **Images without alt:** Every \`<img>\` must have an \`alt\` attribute. Decorative images must use \`alt=""\` with \`aria-hidden="true"\`.
2. **Interactive elements without labels:** Buttons, inputs, and links must have accessible names — via visible text, \`aria-label\`, or \`aria-labelledby\`.
3. **Click handlers on non-interactive elements:** \`onClick\` on \`<div>\` or \`<span>\` requires \`role="button"\`, \`tabIndex={0}\`, and keyboard event handlers (\`onKeyDown\`).
4. **Missing focus management in modals:** Dialogs must trap focus, return focus to the trigger on close, and have \`role="dialog"\` with \`aria-modal="true"\`.
5. **Color-only indicators:** Status communicated only through color (red/green) must also include text, icon, or \`aria-live\` announcement.
6. **Form error association:** Error messages must be linked to their input via \`aria-describedby\` matching the error element's \`id\`.
7. **Heading hierarchy:** Pages must not skip heading levels (e.g., \`<h1>\` followed by \`<h3>\` with no \`<h2>\`).

## Severity mapping
- Missing alt on informative images → WARNING
- Click on div without keyboard support → WARNING
- Missing focus trap in modal → CRITICAL
- Heading skip, color-only → SUGGESTION`,
  },
  {
    name: 'go-error-handling',
    desc: 'Flags unchecked errors and bare panic calls in Go code.',
    repo: 'gotools/review-skills',
    stars: 573,
    lang: 'Go',
    body: `# Go Error Handling

## Purpose
Enforce idiomatic Go error handling patterns — every error must be checked, wrapped with context, or explicitly ignored with a comment.

## Rules
1. **Unchecked error return:** Flag any call that returns an error value where the error is assigned to \`_\` without a justification comment.
2. **Bare panic in library code:** \`panic()\` must not be used in library packages — return an error instead. Panics are acceptable only in \`main()\` or test helpers.
3. **Error wrapping:** Errors propagated up the call stack should be wrapped with \`fmt.Errorf("context: %w", err)\` to preserve the chain. Flag bare \`return err\` when the function adds no context.
4. **Sentinel errors:** Exported error variables must use \`errors.New()\` at package scope and follow the \`Err\` prefix convention (e.g., \`ErrNotFound\`).
5. **Deferred close errors:** \`defer f.Close()\` discards the error. In write paths, capture and check the error from Close.
6. **Error type assertions:** Prefer \`errors.Is()\` and \`errors.As()\` over direct type assertions or string matching on \`err.Error()\`.

## Severity mapping
- Unchecked error on I/O or network calls → CRITICAL
- Bare panic in library code → WARNING
- Missing wrap context → SUGGESTION`,
  },
  {
    name: 'python-type-hints',
    desc: 'Warns on missing type annotations in public APIs.',
    repo: 'pydev/agent-skills',
    stars: 421,
    lang: 'Python',
    body: `# Python Type Hints

## Purpose
Ensure public API surfaces have complete type annotations for documentation, IDE support, and static analysis with mypy/pyright.

## Rules
1. **Public function signatures:** All public functions (not prefixed with \`_\`) must annotate every parameter and the return type.
2. **Class attributes:** Public class attributes defined in \`__init__\` should have type annotations, either inline or via a class-level annotation.
3. **No bare \`Any\`:** Avoid \`Any\` unless interfacing with an untyped library. Prefer \`object\`, protocol types, or generics.
4. **Collection specificity:** Use \`list[str]\`, \`dict[str, int]\` instead of bare \`list\`, \`dict\`. Prefer \`Sequence\` / \`Mapping\` for read-only params.
5. **Optional clarity:** Use \`X | None\` (Python 3.10+) or \`Optional[X]\` — never pass \`None\` where the annotation says \`X\`.
6. **TypedDict for structured dicts:** Functions returning \`dict\` with known keys should use \`TypedDict\` for self-documenting shapes.

## Severity mapping
- Public API without return type → WARNING
- Bare Any in core logic → WARNING
- Missing param annotation in internal helper → SUGGESTION`,
  },
  {
    name: 'docker-best-practices',
    desc: 'Flags multi-stage issues, root user, and layer bloat.',
    repo: 'devops-skills/catalog',
    stars: 389,
    lang: 'any',
    body: `# Docker Best Practices

## Purpose
Review Dockerfiles for security, build performance, and image size issues.

## Rules
1. **Don't run as root:** The final stage must include a \`USER\` instruction with a non-root user. Running as root in production is a privilege escalation risk.
2. **Pin base image versions:** Use digest or specific tag (e.g., \`node:20.11-slim\`), never \`latest\`, to ensure reproducible builds.
3. **Minimize layers:** Combine related \`RUN\` commands with \`&&\` to reduce image layers. Clean up package caches in the same layer (\`rm -rf /var/cache/apt\`).
4. **Multi-stage builds:** Build dependencies (compilers, dev packages) must stay in the builder stage — the final image should only contain runtime dependencies.
5. **COPY before RUN:** Copy dependency manifests (package.json, go.mod) and install before copying source — this maximizes Docker layer cache hits.
6. **No secrets in build args:** Never pass secrets via \`ARG\` or \`ENV\` — they persist in image layers. Use BuildKit secret mounts instead.
7. **Health checks:** Production images should include a \`HEALTHCHECK\` instruction for orchestrator liveness probes.

## Severity mapping
- Running as root → CRITICAL
- Secrets in build args → CRITICAL
- Unpinned base image → WARNING
- Layer bloat, cache order → SUGGESTION`,
  },
  {
    name: 'api-breaking-changes',
    desc: 'Detects breaking API signature changes and missing versioning.',
    repo: 'api-guild/skills',
    stars: 756,
    lang: 'any',
    body: `# API Breaking Changes

## Purpose
Detect changes to HTTP API contracts that would break existing consumers.

## Rules
1. **Removed endpoints:** Flag any deleted route handler — consumers relying on it will get 404s.
2. **Renamed or removed fields:** Flag removal or renaming of response body fields. New fields are safe; removed fields break deserialization.
3. **Changed status codes:** Flag changes to success status codes (e.g., 200 → 201) — consumers may check exact codes.
4. **Narrowed input types:** Flag added required fields to request bodies or tightened validation (e.g., optional → required). Widening is safe.
5. **Path parameter changes:** Flag renamed or removed path/query parameters.
6. **Missing versioning:** If the API has no version prefix (\`/v1/\`, \`/v2/\`) and a breaking change is introduced, flag it as needing a version bump.
7. **Changed content types:** Flag changes from \`application/json\` to another content type or vice versa.

## Exceptions
- Alpha / internal APIs (documented as unstable) are exempt.
- Additive changes (new optional fields, new endpoints) are always safe.

## Severity mapping
- Removed endpoint or field → CRITICAL
- Changed status code or content type → WARNING
- Missing versioning on breaking change → WARNING`,
  },
  {
    name: 'test-coverage-nudge',
    desc: 'Suggests tests when new branches lack assertions.',
    repo: 'testing-guild/skills',
    stars: 294,
    lang: 'any',
    body: `# Test Coverage Nudge

## Purpose
Encourage test coverage for new code paths. Flag untested branches, edge cases, and error paths.

## Rules
1. **New functions without tests:** Public functions added in this PR should have at least one corresponding test case.
2. **New branches without coverage:** If a function adds \`if/else\`, \`switch\`, or ternary branches, suggest tests for both paths.
3. **Error paths:** New \`catch\` blocks, error returns, or fallback branches should have tests exercising the failure scenario.
4. **Changed behavior:** If an existing function's behavior changes (different return value, side effect), the existing tests should be updated to assert the new behavior.
5. **Snapshot-only tests:** Flag test files that rely entirely on snapshots without behavioral assertions — snapshots catch regressions but don't prove correctness.
6. **Test file location:** Test files should be colocated with source (\`foo.test.ts\` next to \`foo.ts\`) or in a conventional \`__tests__/\` directory.

## Severity mapping
- New public API without any test → WARNING
- Untested error/edge paths → SUGGESTION
- Missing test update for changed behavior → WARNING`,
  },
  {
    name: 'secret-leakage-gate',
    desc: 'Detects API keys, service_role, and NEXT_PUBLIC_ secrets in code.',
    repo: 'secdev/agent-skills',
    stars: 1105,
    lang: 'any',
    body: `# Secret Leakage Gate

## Purpose
Prevent secrets, API keys, and sensitive credentials from being committed to the repository.

## Rules
1. **Hardcoded API keys:** Flag strings matching common API key patterns (e.g., \`sk-\`, \`AKIA\`, \`ghp_\`, \`xoxb-\`) in source files.
2. **Service role keys:** Flag Supabase \`service_role\` keys or other admin-level tokens in client-accessible code.
3. **NEXT_PUBLIC_ secrets:** Flag \`NEXT_PUBLIC_\` env vars that contain secrets — these are embedded in client bundles and visible to end users.
4. **Private keys:** Flag PEM-encoded private keys (\`-----BEGIN.*PRIVATE KEY-----\`) in any non-gitignored file.
5. **Connection strings with passwords:** Flag database URLs or connection strings containing plaintext passwords (e.g., \`postgres://user:pass@\`).
6. **JWT secrets:** Flag hardcoded JWT signing secrets or HMAC keys.
7. **.env files committed:** Flag any \`.env\`, \`.env.local\`, or \`.env.production\` file that is not gitignored.

## Exceptions
- Test fixtures with fake/placeholder values (clearly marked as \`test-\`, \`fake-\`, \`example-\`).
- Documentation examples.

## Severity mapping
- Real API key or private key in source → CRITICAL
- Connection string with password → CRITICAL
- NEXT_PUBLIC_ secret → WARNING
- .env file committed → WARNING`,
  },
  {
    name: 'css-perf-review',
    desc: 'Warns on layout thrashing, forced reflows, and heavy selectors.',
    repo: 'frontend-guild/skills',
    stars: 215,
    lang: 'CSS',
    body: `# CSS Performance Review

## Purpose
Detect CSS patterns that cause layout thrashing, expensive repaints, or unnecessary rendering work.

## Rules
1. **Forced synchronous layout:** Flag JavaScript that reads layout properties (offsetHeight, getBoundingClientRect) after DOM writes in the same frame — causes forced reflow.
2. **Expensive selectors:** Flag deeply nested selectors (4+ levels), universal selectors (\`*\`) in the middle of chains, and attribute selectors on large DOMs.
3. **Layout thrashing in loops:** Flag loops that alternate between reading and writing DOM properties — batch reads before writes.
4. **Overuse of !important:** Flag \`!important\` usage — it breaks cascade predictability and makes overrides harder.
5. **Large box-shadow / filter:** Flag \`box-shadow\` with blur radius > 20px or multiple layered shadows on frequently re-rendered elements — these are GPU-expensive.
6. **Animating layout properties:** Flag animations on \`width\`, \`height\`, \`top\`, \`left\`, \`margin\`, \`padding\` — prefer \`transform\` and \`opacity\` which run on the compositor.
7. **Unused CSS:** Flag selectors that don't match any element in the component's JSX/HTML.

## Severity mapping
- Layout thrashing in loop → WARNING
- Animating layout properties → WARNING
- Expensive selectors, unused CSS → SUGGESTION`,
  },
  {
    name: 'rust-unsafe-audit',
    desc: 'Reviews unsafe blocks for soundness and documents invariants.',
    repo: 'rust-skills/catalog',
    stars: 467,
    lang: 'Rust',
    body: `# Rust Unsafe Audit

## Purpose
Review \`unsafe\` blocks for soundness, ensure invariants are documented, and minimize unsafe surface area.

## Rules
1. **Justify every unsafe block:** Each \`unsafe\` block must have a \`// SAFETY:\` comment explaining why the invariants are upheld.
2. **Minimize unsafe scope:** \`unsafe\` blocks should contain only the unsafe operation — surrounding safe code should be outside the block.
3. **Raw pointer dereference:** Flag raw pointer dereferences without a preceding null/alignment check or documented proof of validity.
4. **FFI boundary checks:** Flag \`extern "C"\` functions that don't validate input pointers for null, alignment, and lifetime.
5. **Transmute audit:** Flag \`std::mem::transmute\` — prefer \`as\` casts, \`from_bits\`, or safe wrapper types. If transmute is necessary, document the layout guarantee.
6. **Send/Sync impls:** Manual \`unsafe impl Send\` or \`Sync\` must document why the type is thread-safe — incorrect impls cause data races.
7. **Mutable aliasing:** Flag patterns where \`unsafe\` code creates multiple \`&mut\` references to the same data — this is instant UB.

## Severity mapping
- Missing SAFETY comment → WARNING
- Potential mutable aliasing or null deref → CRITICAL
- Transmute without justification → WARNING
- Broad unsafe scope → SUGGESTION`,
  },
];
