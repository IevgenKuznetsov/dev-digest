import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 14 Claude sessions total.
 *   - 10 × trace    → 1 session each                      = 10
 *   -  2 × activation pair (positive + near-miss negative) =  4
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // ─── 1. Subagent dispatch + doc routing ────────────────────────────────────────────────────────

  // trace (1 session): CLAUDE.md "Read When" routing + subagent dispatch, together
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    name: "API-route task reads api-contracts AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями API цього репо. Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/docs/api-contracts.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // trace (1 session): two "Read When" rows at once
  {
    kind: "trace",
    // Tests the CLAUDE.md "Read When" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("розберись, як усе влаштовано") sent the model straight
    // into schema.ts / pipeline.run.ts and it never opened the routed doc. One anchor doc (pipeline.md)
    // keeps this a deterministic routing check — asserting two docs in one session is inherently flaky.
    name: "pipeline task follows CLAUDE.md routing to pipeline.md",
    prompt:
      "Я збираюся змінити review pipeline. Перш ніж торкатися коду — звірся з настановами цього репо " +
      "(CLAUDE.md) щодо того, яку документацію треба прочитати для змін у pipeline, і прочитай саме ці документи.",
    expectFilesRead: ["reviewer-core/docs/pipeline.md"],
    maxTurns: 8,
  },

  // trace (1 session): CLAUDE.md "Hit unexpected behavior" routing -> gotchas
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path and read gotchas.md, making the negative flaky. As a single-session trace it
  // reliably checks the same routing rule: in the real repo, the discovery prompt reads gotchas.md.
  {
    kind: "trace",
    name: "CLAUDE.md routes a gotchas lookup to reviewer-core/insights",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де це вже могло бути задокументовано? Прочитай той файл.",
    expectFilesRead: ["reviewer-core/insights/gotchas.md"],
    maxTurns: 5,
  },

  // ─── 2. Package-level CLAUDE.md routing ────────────────────────────────────────────────────────
  // Root CLAUDE.md rule: "Before exploring the codebase, always check the relevant package's
  // curated sources first: <package>/CLAUDE.md". These traces verify the rule fires for server/
  // and client/ — the two packages agents enter most often.

  // trace (1 session): server task → reads server/CLAUDE.md
  {
    kind: "trace",
    name: "server task reads server/CLAUDE.md before exploring code",
    prompt:
      "Хочу додати новий Fastify-модуль для push-нотифікацій у server/. " +
      "Перш ніж пропонувати рішення — звірся з настановами серверного пакету цього репо " +
      "і прочитай відповідний CLAUDE-файл.",
    expectFilesRead: ["server/CLAUDE.md"],
    maxTurns: 5,
  },

  // trace (1 session): client task → reads client/CLAUDE.md
  {
    kind: "trace",
    name: "client task reads client/CLAUDE.md before exploring code",
    prompt:
      "Збираюся додати новий React-компонент у client/. " +
      "Перш ніж пропонувати рішення — звірся з настановами клієнтського пакету цього репо " +
      "і прочитай відповідний CLAUDE-файл.",
    expectFilesRead: ["client/CLAUDE.md"],
    maxTurns: 5,
  },

  // ─── 3. Gotcha routing ─────────────────────────────────────────────────────────────────────────
  // Root CLAUDE.md documents two concrete gotchas; package CLAUDE.md files document their own.
  // These traces verify the agent is routed to the right file before touching code.

  // trace (1 session): "relation does not exist" → root CLAUDE.md Gotchas section
  {
    kind: "trace",
    name: "DB migration error routes to root CLAUDE.md gotchas",
    prompt:
      "Після зміни схеми Drizzle у мене помилка 'relation does not exist'. " +
      "За правилами цього репо — де задокументовані такі пастки? Прочитай той файл.",
    expectFilesRead: ["CLAUDE.md"],
    maxTurns: 5,
  },

  // trace (1 session): Fastify rejects body-less POST from client → client/CLAUDE.md Gotchas
  {
    kind: "trace",
    name: "client api.ts body-less POST gotcha routes to client/CLAUDE.md",
    prompt:
      "Fastify відхиляє мій body-less POST запит з клієнтського коду. " +
      "За правилами цього репо — де задокументовані пастки клієнтського шару? Прочитай той файл.",
    expectFilesRead: ["client/CLAUDE.md"],
    maxTurns: 5,
  },

  // ─── 4. "Do not touch" guardrails ──────────────────────────────────────────────────────────────

  // trace (1 session): edit existing vendor/shared contract → agent reads server/CLAUDE.md
  // which says "vendor/shared/ — add new contract files, never edit existing ones".
  {
    kind: "trace",
    name: "vendor/shared edit request routes to server/CLAUDE.md do-not-touch rule",
    prompt:
      "Хочу змінити існуючий Zod-контракт у server/src/vendor/shared/. " +
      "Перш ніж давати поради — звірся з правилами серверного пакету цього репо.",
    expectFilesRead: ["server/CLAUDE.md"],
    maxTurns: 5,
  },

  // trace (1 session): refactor prompt.ts → agent reads reviewer-core/CLAUDE.md
  // which warns "Do not touch INJECTION_GUARD".
  {
    kind: "trace",
    name: "INJECTION_GUARD refactor request routes to reviewer-core/CLAUDE.md",
    prompt:
      "Хочу відрефакторити reviewer-core/src/prompt.ts і прибрати дублювання коду. " +
      "Перш ніж давати поради — звірся з настановами reviewer-core пакету цього репо " +
      "і прочитай відповідний CLAUDE-файл.",
    expectFilesRead: ["reviewer-core/CLAUDE.md"],
    maxTurns: 5,
  },

  // ─── 5. Secrets convention ─────────────────────────────────────────────────────────────────────

  // trace (1 session): secrets question → root CLAUDE.md "Secrets live in ~/.devdigest/secrets.json"
  {
    kind: "trace",
    name: "secrets question routes to root CLAUDE.md and SecretsProvider convention",
    prompt:
      "Де в цьому репо зберігаються API ключі для LLM і як до них треба звертатися у коді? " +
      "За правилами репо — прочитай відповідний документ перед відповіддю.",
    expectFilesRead: ["CLAUDE.md"],
    maxTurns: 5,
  },

  // ─── 6. engineering-insight activation ─────────────────────────────────────────────────────────

  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insight",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },

  // ─── 7. pr-self-review activation ──────────────────────────────────────────────────────────────
  // Root CLAUDE.md: "After every git commit, invoke /pr-self-review. This is not optional."

  {
    kind: "activation",
    name: "pr-self-review activates when user mentions a fresh git commit",
    prompt:
      "Я щойно зробив git commit із змінами в модулі reviews. " +
      "Що тепер потрібно зробити згідно правил цього репо?",
    skill: "pr-self-review",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — git conventions question must NOT trigger pr-self-review",
    prompt:
      "Як правильно робити git commit у цьому проекті? Які конвенції щодо повідомлень?",
    skill: "pr-self-review",
    shouldActivate: false,
    maxTurns: 4,
  },
];
