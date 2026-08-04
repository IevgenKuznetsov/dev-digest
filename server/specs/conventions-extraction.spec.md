# Conventions Extraction

## Data Model

A **Convention** is an observed coding pattern/rule extracted from a repository,
backed by evidence (file path + code snippet). Conventions are workspace- and
repo-scoped, stored in the `conventions` table.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK, auto-generated |
| `workspace_id` | uuid | FK → workspaces, cascade delete |
| `repo_id` | uuid | FK → repos, cascade delete (nullable) |
| `rule` | text | `[Category] Rule text` — category is a prefix, not a column |
| `evidence_path` | text | Relative file path in the repo clone |
| `evidence_snippet` | text | 1–5 line code snippet from the evidence file |
| `confidence` | double | 0.0–1.0, how consistently the pattern appears |
| `accepted` | boolean | User decision; default `false` |

### Category Encoding

The DB has no `category` column. Category is embedded as a `[Category]` prefix
in the `rule` text (e.g. `[Naming] Use camelCase for local variables`). The LLM
response schema has `category` as a separate field — it gets merged into `rule`
before persistence. Clients parse the prefix for grouping/display.

Recognized categories: Naming, Structure, Error Handling, Testing, Typing,
Formatting, API Design, State Management, Dependencies. The LLM may produce
others; no validation enforced.

### Shared DTO

`ConventionCandidate` from `@devdigest/shared` (`contracts/knowledge.ts`):

```typescript
{ id: string, rule: string, evidence_path: string,
  evidence_snippet: string, confidence: number, accepted: boolean }
```

This contract is extend-only — never edit.

## API Surface

All routes are workspace-scoped via `getContext()`.

### `GET /repos/:id/conventions` — List conventions

Returns `ConventionCandidate[]` ordered by confidence descending.

Empty array if no extraction has been run.

### `POST /repos/:id/conventions/extract` — Run extraction

Runs the full extraction pipeline (see below). Replaces any previous conventions
for this repo (clean slate). Returns `ConventionCandidate[]`.

Error conditions:

| Condition | Code | Status |
|-----------|------|--------|
| Repo not found | `not_found` | 404 |
| Repo not cloned | `validation_error` | 422 |
| Clone directory missing on disk | `validation_error` | 422 |
| Fewer than 2 sample files | `validation_error` | 422 |
| LLM call fails | `external_service_error` | 502 |

If the LLM returns candidates but none survive evidence verification, returns
an empty array (not an error).

### `PATCH /conventions/:id` — Accept or reject one

Body: `{ accepted: boolean }`

Returns the updated `ConventionCandidate`. 404 if not found or wrong workspace.

### `PATCH /conventions/batch` — Batch accept/reject

Body: `{ ids: string[] (uuid, min 1), accepted: boolean }`

Returns `{ updated: number }` — count of rows changed.

Use case: "Deselect all" button sets `accepted: false` for all convention ids.

### `DELETE /repos/:id/conventions` — Clear all

Deletes all conventions for the repo. Returns 204 (no body).

Use case: explicit cleanup before re-scan, or when removing a repo.

### `POST /repos/:id/conventions/skill` — Create skill from accepted

Body: `{ name: string (min 1), description: string }`

1. Fetches all conventions for the repo where `accepted = true`.
2. If none accepted, returns 422 `validation_error`.
3. Builds a markdown skill body grouped by category (see Skill Body Format).
4. Creates a skill via `SkillsService.create()` with `type: 'convention'`,
   `source: 'extracted'`, `enabled: true`.
5. Returns the created `Skill` (201).

## Extraction Pipeline

The pipeline runs synchronously (not via job queue). A cheap/fast model is used
(`gpt-5.4` by default, configurable per-workspace via Feature Models).

### Step 1: Sample Collection (pure code, no model)

Two sources collected in parallel:

**Config files** — well-known config file names read from the repo clone root:
- ESLint: `.eslintrc`, `.eslintrc.{js,json,yml,cjs}`, `eslint.config.{js,mjs,ts}`
- Prettier: `.prettierrc`, `.prettierrc.{js,json,yml}`, `prettier.config.js`
- TypeScript: `tsconfig.json`
- Misc: `.editorconfig`, `biome.json`, `biome.jsonc`, `package.json`

Each capped at 4 KB. Missing files silently skipped.

**Top source files** — `repoIntel.getConventionSamples(repoId, 12)` returns
the 12 highest-ranked files by PageRank, excluding tests, configs, migrations,
and generated files. Each file read from the clone, capped at 8 KB.

Guard: if total files < 2, abort with 422.

### Step 2: LLM Call

Provider and model resolved via `resolveFeatureModel(container, workspaceId, 'conventions')`.

Single `completeStructured` call with:
- `schema`: `ConventionExtraction` (internal Zod schema)
- `schemaName`: `'ConventionExtraction'`
- `temperature`: 0.2
- `maxTokens`: 4096

**System prompt**: Senior code reviewer persona. Instructs to extract conventions
that are ACTUALLY FOLLOWED (not aspirational), backed by evidence. Lists the
category taxonomy. Requires file + snippet + confidence per convention.

**User prompt**: Config files and source files formatted as markdown code blocks
with file path headers. Instruction to extract 8–20 conventions.

**LLM Response Schema** (internal to module, not in `vendor/shared/`):

```typescript
ConventionEvidence = { file: string, snippet: string, line?: number }

RawCandidate = {
  category: string,    // "Naming", "Error Handling", etc.
  rule: string,        // "Use camelCase for variables"
  evidence: ConventionEvidence,
  confidence: number   // 0.0–1.0
}

ConventionExtraction = {
  conventions: RawCandidate[]  // min 1, max 30
}
```

### Step 3: Evidence Verification (pure code, no model)

For each candidate returned by the LLM:

1. **File existence** (hard gate): `access(clonePath + evidence.file)`.
   If the file does not exist → **drop the candidate entirely**.

2. **Snippet match** (soft gate):
   - If `evidence.line` is provided: check ±5 lines around the cited line for the
     first line of the snippet.
   - If not found near the cited line (or no line provided): search the entire file.
   - If found: correct the line number to the actual location.
   - If snippet not found anywhere: clear the snippet, reduce confidence by 0.2
     (file exists but evidence is weak).

Candidates that survive verification are persisted.

### Step 4: Persistence

1. Delete all existing conventions for this (workspace, repo).
2. Insert verified candidates with `accepted: false`.
3. Return the inserted rows as DTOs.

## Skill Body Format

Generated by `buildSkillBody(repoName, conventions)`. Grouped by category:

```markdown
# {repoName}-conventions

House conventions for '{repoName}'. Flag changes that violate any rule below
and cite the offending 'file:line'.

## {Category}
- {rule text}
  Detected in '{evidencePath}':
  ```
  {snippet}
  ```

## {Category}
- ...
```

Matches the format shown in design mockup `design2.png`.

## Module Structure

```
server/src/modules/conventions/
  routes.ts        — Fastify plugin registered in modules/index.ts
  service.ts       — ConventionsService (pipeline + CRUD)
  repository.ts    — ConventionsRepository (Drizzle CRUD)
  helpers.ts       — Config detection, evidence verification, DTO mapping, LLM schemas
```

Row type: `ConventionRow` exported from `server/src/db/rows.ts`.

## Feature Model

Registered in `FEATURE_MODELS` (`contracts/platform.ts`):

| Field | Value |
|-------|-------|
| id | `conventions` |
| label | `Conventions` |
| description | `Extracts coding conventions from the repo.` |
| defaultProvider | `openai` |
| defaultModel | `gpt-5.4` |

Override per workspace in Settings → Feature Models.

## Testing

### Unit tests (`helpers.test.ts`)

- `collectConfigFiles`: tmpdir with some config files → returns found ones, skips missing
- `verifyEvidence`: file exists + snippet found → returns corrected line; file missing → null; snippet missing → penalized confidence
- `toConventionDto`: row ↔ DTO mapping
- `buildSkillBody`: accepted conventions → correct grouped markdown

### Integration tests (`conventions.it.test.ts`)

Use `app.inject()` with `MockLLMProvider` (`structuredBySchema: { ConventionExtraction: fixture }`).

- POST extract → conventions persisted → GET list returns them
- PATCH accept → toggles accepted flag
- PATCH batch → bulk update
- POST skill → skill created with correct body and type `'convention'`
- DELETE → conventions cleared
- Error paths: missing repo (404), no clone (422), LLM failure (502)
