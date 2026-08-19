import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// NOTE: Bash is stripped by agentTools() (MUTATING_TOOLS includes Bash) so the agent cannot run
// `git diff main...HEAD --name-only` during eval. It must derive affected scope from the diff text
// embedded in the prompt. This is the correct fallback — but without it the agent risks Globbing
// the full repo (e.g. server/src/modules/**) and reading files outside the diff, burning tokens on
// unrelated real code. The scope-confinement case below directly guards against that regression.

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("checkout-service.diff")}`;

// A second real diff whose violations map onto DevDigest-SPECIFIC rule names
// (`reviewer-core-zero-io`, `reviewer-core-ground-findings-gate`) that a competent model will
// describe in prose but will not spontaneously name unless the agent forces a citation. This is
// the discriminating case for the strict-vs-lite A/B: both variants should FIND both problems,
// but only the strict variant (which keeps the "cite the exact documented rule per finding" hard
// rule) should reliably emit the identifier. The checkout diff's textbook violations don't
// discriminate — the model volunteers `inward-only-dependencies`/`di-discipline` either way.
const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

// A client-only change: a Next.js page that stopped being thin (state + useEffect added) and
// calls the API directly with fetch instead of going through a TanStack Query hook. No server or
// reviewer-core files touched — server rules and their associated skills should be skipped.
const CLIENT_FAT_PAGE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("client-only-fat-page.diff")}`;

// A diff touching only README.md — no code, no imports, no layer boundaries. The agent's
// "early exit check" (procedure step 2) should fire immediately, set verdict to PASS, and stop.
const DOCS_ONLY_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("docs-only.diff")}`;

// An edit to an existing file inside server/src/vendor/shared/ — the "extend-only" contract
// in CLAUDE.md makes this CRITICAL regardless of how benign the change looks. A new optional
// field is added, which is a modification of an existing contract file.
const VENDOR_SHARED_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("vendor-shared-edit.diff")}`;

// Removal of the INJECTION_GUARD constant from reviewer-core/src/prompt.ts — this is one of
// the two "Do not touch" entries in CLAUDE.md. Any modification must be CRITICAL regardless of
// intent. The diff shows the constant being removed rather than just renamed.
const INJECTION_GUARD_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("injection-guard-edit.diff")}`;

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "cites the specific documented rule" keeps passing.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    // Grounding on concrete tokens from the diff itself, not invented rule IDs.
    // Previous grounding on `inward-only-dependencies`/`di-discipline` failed 100% of the time
    // because those strings don't appear in CLAUDE.md — the agent never emitted them unprompted.
    grounding: ["FastifyReply", "PgCheckoutRepository", "FAIL"],
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a violation of the inward-only dependency rule between Domain and Presentation layers",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a violation of DI discipline (concrete adapters/repositories must be constructed only in the composition root / container)",
      "names the specific documented rule identifier for EVERY finding (e.g. `inward-only-dependencies`, `di-discipline`) rather than describing the problem only in prose",
      "assigns a severity (critical/high/medium/low/info) to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 1.0,
    maxTurns: 15,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    grounding: ["FAIL"],
    prompt: REVIEW_PROMPT,
    practices: [
      "does not invent an architecture-contract violation for the optional `reply?: FastifyReply` parameter beyond the inward-only-dependencies import issue itself (no runtime bug/security finding fabricated as an architecture rule)",
      "stays scoped to structural/layering/DI findings — does not comment on naming conventions, code style, or test coverage",
      "does not append a 'Required Actions', 'Recommended Actions', or numbered fix list after the findings",
    ],
    threshold: 1.0,
    maxTurns: 15,
  },
  {
    name: "cites the DevDigest-specific rule identifier for reviewer-core violations",
    kind: "quality",
    // Grounding on tokens that MUST appear in any correct answer regardless of exact rule-ID phrasing.
    // Previous grounding on `reviewer-core-zero-io`/`reviewer-core-ground-findings-gate` failed
    // because those strings only exist in the agent definition, not in CLAUDE.md/INSIGHTS.md.
    grounding: ["readFileSync", "groundFindings", "FAIL"],
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` gate before emitting findings",
      "names the exact documented rule identifier `reviewer-core-zero-io` for the fs-import finding rather than only describing it in prose",
      "names the exact documented rule identifier `reviewer-core-ground-findings-gate` for the skipped-gate finding rather than only describing it in prose",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 1.0,
    maxTurns: 15,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    grounding: ["PASS"],
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the benign rename (or records only `info`-level, non-blocking observations) — it does not invent a critical/high/medium finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the final gate verdict is PASS",
    ],
    threshold: 1.0,
    maxTurns: 10,
  },
  {
    // KEY TOKEN-SAFETY CASE: Without Bash the agent cannot run `git diff --name-only`.
    // It must parse the diff text in the prompt for scope — NOT Glob the entire modules directory.
    // A rogue Glob of server/src/modules/** would pull in real repo files and generate findings
    // for code that was never changed, burning tokens and producing false positives.
    name: "confines review scope to the single changed module and reports skipped categories",
    kind: "quality",
    grounding: ["checkout", "Skipped"],
    prompt: REVIEW_PROMPT,
    practices: [
      "derives affected scope from the embedded diff text — identifies server/modules/checkout as the only changed module and does not enumerate or visit any other server module directory",
      "does not produce findings for any module other than the checkout module (e.g. no findings referencing blast, auth, pr-review, or any other module not in the diff)",
      // Reworded from 'reviewer-core rules' to match the label the agent actually writes
      "the report's 'Skipped categories' line includes at minimum client-side rules and cross-package (reviewer-core) rules, because no client or reviewer-core files appear in the diff",
      "the 'Modules reviewed' or 'Affected modules' header in the report names only the checkout module",
    ],
    threshold: 1.0,
    maxTurns: 15,
  },
  {
    name: "applies client-side rules and skips server-side rules for a client-only change",
    kind: "quality",
    grounding: ["fetch", "FAIL"],
    prompt: CLIENT_FAT_PAGE_PROMPT,
    practices: [
      "flags the direct `fetch('/api/prs')` call in the page component as a violation of the client-side rule prohibiting raw API calls in components (must use TanStack Query hooks from lib/hooks/)",
      "flags that the page component is not thin — it contains useState and useEffect logic that belongs in a dedicated hook, not in the page file",
      "does not report any server-side findings (onion-architecture, DI discipline, adapter compliance, Zod) — no server files are in the diff",
      "reports that server-side rule categories are skipped because no server files changed",
    ],
    threshold: 1.0,
    maxTurns: 12,
  },
  {
    name: "early-exits with PASS verdict for a documentation-only change",
    kind: "quality",
    // Grounding changed from ["PASS"] to "No architecture-relevant" — the agent consistently
    // writes "No architecture-relevant changes detected" but sometimes omits a formal PASS line,
    // causing the previous grounding to block the judge on runs where verdict was written as N/A.
    grounding: ["No architecture-relevant"],
    prompt: DOCS_ONLY_PROMPT,
    practices: [
      "recognizes the diff contains only documentation or README files — no code, imports, or layer boundaries changed",
      "reports 'No architecture-relevant changes' or equivalent and produces no findings",
      "does not list any CRITICAL, HIGH, MEDIUM, or LOW violations",
      "the final gate verdict is PASS (not N/A, not skipped — the verdict line must say PASS)",
    ],
    threshold: 1.0,
    maxTurns: 8,
  },
  {
    name: "flags vendor/shared modification as CRITICAL regardless of how benign the change looks",
    kind: "quality",
    // vendor-shared-extend-only is a "Do not touch" rule → must be CRITICAL + FAIL
    grounding: ["vendor/shared", "CRITICAL", "FAIL"],
    prompt: VENDOR_SHARED_PROMPT,
    practices: [
      "identifies that the diff modifies an existing file inside server/src/vendor/shared/ (contracts/pr.ts)",
      "classifies this as CRITICAL severity — the vendor/shared extend-only rule is a 'Do not touch' contract from CLAUDE.md",
      "cites the rule identifier `vendor-shared-extend-only` in the finding",
      "the final verdict is FAIL because a CRITICAL finding exists",
      "does not treat the change as benign just because only an optional field was added — modification of any existing vendor/shared file is CRITICAL regardless of the change's apparent safety",
    ],
    threshold: 1.0,
    maxTurns: 10,
  },
  {
    name: "flags INJECTION_GUARD removal as CRITICAL",
    kind: "quality",
    // INJECTION_GUARD is explicitly listed as "Do not touch" in CLAUDE.md → must be CRITICAL + FAIL
    grounding: ["INJECTION_GUARD", "CRITICAL", "FAIL"],
    prompt: INJECTION_GUARD_PROMPT,
    practices: [
      "identifies that the diff removes the INJECTION_GUARD constant from reviewer-core/src/prompt.ts",
      "classifies this as CRITICAL severity — INJECTION_GUARD is a 'Do not touch' entry in CLAUDE.md",
      "cites the rule identifier `reviewer-core-injection-guard` in the finding",
      "the final verdict is FAIL because a CRITICAL finding exists",
      "does not soften the severity because the constant was 'just a comment' — its protective function makes removal CRITICAL",
    ],
    threshold: 1.0,
    maxTurns: 10,
  },
];
