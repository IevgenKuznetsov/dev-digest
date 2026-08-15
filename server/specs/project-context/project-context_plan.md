# Implementation Plan: Project Context

Plan ID: ProjectContext_Plan_1
Spec: ProjectContext_1
Status: ready

## Overview

This plan implements the Project Context feature across both server and client.
Users will be able to scan repos for markdown context files, browse/edit/create
them, attach them to agents and skills, and see which documents were injected in
run traces. The feature touches the DB schema, a new Fastify module, the review
pipeline, shared contracts, sidebar navigation, and four new/modified UI screens.

## Decisions (from clarifying questions)

| # | Question | Decision |
|---|----------|----------|
| 1 | Scope | Both server AND client |
| 2 | `specs_read` contract change | Option B: New `SpecReadEntry` schema in a new file `vendor/shared/contracts/context-doc.ts`, referenced from `trace.ts` via import |
| 3 | Scanning trigger | Separate registered job kind (`context-scan`), not piggybacking on clone |
| 4 | `@fastify/multipart` | NOT installed; must be added as a dependency |
| 5 | Context merge orchestration | Option A: In the `project-context` module's service — a `resolveContextForAgent(agentId, repoId)` method |
| 6 | Concurrent scan guard | 409 rejection (no queuing) |

---

## Phase 1 — Data layer (server)

### Step 1.1: New shared contract — `SpecReadEntry`

**File (NEW):** `server/src/vendor/shared/contracts/context-doc.ts`

Create a new contract file with:

```ts
import { z } from 'zod';

export const ContextDocCategory = z.enum(['specs', 'docs', 'insights', 'other']);
export type ContextDocCategory = z.infer<typeof ContextDocCategory>;

export const SpecReadEntry = z.object({
  path: z.string(),
  category: ContextDocCategory,
  tokens: z.number(),
});
export type SpecReadEntry = z.infer<typeof SpecReadEntry>;
```

**Why a new file:** The `vendor/shared/` rule is "extend with new files only,
never edit existing contracts." The `SpecReadEntry` schema is a new contract.

**File (EDIT):** `server/src/vendor/shared/contracts/trace.ts`

Change the `specs_read` field in `RunTrace` from:
```ts
specs_read: z.array(z.string()),
```
to a **backward-compatible union** that accepts both old string format and new
enriched format:
```ts
specs_read: z.array(z.union([z.string(), SpecReadEntry])),
```

Add the import of `SpecReadEntry` from `./context-doc.js`.

**Why a union, not a direct replacement:** Although `specs_read` is `[]` in most
production traces, the DB stores traces as JSONB. Old traces may contain string
arrays (e.g., from CI agents via `trace-builder.ts`, or test fixtures like
`server/test/contracts.test.ts:168` which uses
`specs_read: ['specs/security-baseline.md']`). A direct change to
`z.array(SpecReadEntry)` would break Zod `.parse()` calls on those traces and
crash the client's `TraceBody.tsx` when accessing `.path` on a string. The union
ensures both old and new formats parse successfully.

**Client rendering must handle both shapes:** In Phase 6, `TraceBody.tsx` must
normalize entries: `typeof sp === 'string' ? { path: sp, category: 'other', tokens: 0 } : sp`.

**File (EDIT):** `server/src/vendor/shared/index.ts` (or barrel)

Re-export `ContextDocCategory`, `SpecReadEntry` from the new contract file.

**File (MIRROR):** `client/src/vendor/shared/contracts/context-doc.ts`

Copy the identical file to the client vendor mirror.

**File (MIRROR EDIT):** `client/src/vendor/shared/contracts/trace.ts`

Same `specs_read` union type change in the client's vendored copy.

**File (EDIT):** `server/test/contracts.test.ts`

Verify the existing test fixture at line 168 (`specs_read: ['specs/security-baseline.md']`)
still passes with the union schema. No change needed — the union accepts strings.

**ACs covered:** AC-U4a

---

### Step 1.2: DB schema — three new tables

**File (NEW):** `server/src/db/schema/project-context.ts`

Define three Drizzle tables:

1. **`contextDocs`** (`context_docs`) — columns: `id` (uuid PK), `workspaceId`
   (FK workspaces, cascade), `repoId` (FK repos, cascade), `path` (text),
   `category` (text enum: specs/docs/insights/other), `tokens` (integer),
   `scannedAt` (timestamptz), `createdAt` (timestamptz default now).
   Indexes: unique on `(repoId, path)`, index on `(repoId)`.

2. **`agentContextDocs`** (`agent_context_docs`) — columns: `agentId` (FK
   agents, cascade), `contextDocId` (FK contextDocs, cascade), `order`
   (integer default 0). Composite PK on `(agentId, contextDocId)`.

3. **`skillContextDocs`** (`skill_context_docs`) — columns: `skillId` (FK
   skills, cascade), `contextDocId` (FK contextDocs, cascade), `order`
   (integer default 0). Composite PK on `(skillId, contextDocId)`.

**File (EDIT):** `server/src/db/schema.ts`

Add barrel exports and schema object entries for all three new tables.

**ACs covered:** AC-U1, AC-U2, AC-U3, AC-X7

---

### Step 1.3: Migration

**Command:** `cd server && pnpm db:generate`

This generates the SQL migration file (e.g. `0012_*.sql`) from the schema diff.
Verify the generated SQL creates the three tables with correct FKs, indexes, and
cascade deletes. Run `pnpm db:migrate` to apply.

**ACs covered:** AC-U1, AC-U2, AC-U3

---

## Phase 2 — Server module (project-context)

### Step 2.1: Module skeleton

Create the module directory `server/src/modules/project-context/` with these files:

**File (NEW):** `server/src/modules/project-context/routes.ts`

Fastify plugin. Registers all routes from the API surface (spec section).
Instantiates `ProjectContextService`. Registers the `context-scan` job handler.

Route groups:
- Context document discovery & management (7 routes under `/repos/:repoId/context/...`)
- Upload endpoint (1 route: `POST /repos/:repoId/context/docs/upload`)
- Context document attachments (4 routes under `/agents/:agentId/context` and `/skills/:skillId/context`)
- Folder management (1 route: `POST /repos/:repoId/context/folders`)

**File (NEW):** `server/src/modules/project-context/service.ts`

Business logic layer:
- `scan(workspaceId, repoId)` — the file scanner
- `listDocs(workspaceId, repoId, search?)` — list with optional filter
- `getDoc(workspaceId, docId)` — single doc metadata
- `readContent(workspaceId, docId)` — read file from disk
- `writeContent(workspaceId, docId, content)` — write + recalculate tokens
- `createDoc(workspaceId, repoId, directory, filename, content?)` — create file
- `uploadDoc(workspaceId, repoId, directory, file)` — handle multipart upload
- `deleteDoc(workspaceId, docId)` — delete from disk + DB
- `createFolder(workspaceId, repoId, directory, name)` — mkdir on disk
- `getAgentContext(workspaceId, agentId)` — list attached docs + total available
- `setAgentContext(workspaceId, agentId, docs)` — replace attached docs
- `getSkillContext(workspaceId, skillId)` — list attached docs
- `setSkillContext(workspaceId, skillId, docs)` — replace attached docs
- `resolveContextForAgent(agentId, repoId)` — the merge algorithm (Phase 3)

**File (NEW):** `server/src/modules/project-context/repository.ts`

Data access layer — all Drizzle queries for context_docs, agent_context_docs,
skill_context_docs. Methods:
- `upsertDocs(docs[])` — bulk upsert by (repoId, path)
- `removeStale(repoId, activePaths)` — delete docs not in active set
- `listByRepo(repoId, search?)` — with optional ILIKE filter on path
- `getById(docId)` — single doc
- `deleteById(docId)` — delete row
- `getAgentDocs(agentId)` — ordered join with contextDocs
- `setAgentDocs(workspaceId, agentId, entries[])` — transactional replace.
  **Must verify** every `contextDocId` in `entries` belongs to `workspaceId`
  before inserting (query `context_docs` WHERE id IN (...) AND workspace_id = workspaceId;
  reject with 400 if any ID is missing from the result). This prevents
  cross-workspace attachment where an attacker supplies a valid contextDocId
  from a different workspace. FK constraints alone do NOT catch this.
- `getSkillDocs(skillId)` — ordered join with contextDocs
- `setSkillDocs(workspaceId, skillId, entries[])` — transactional replace.
  Same cross-workspace validation as `setAgentDocs`.
- `countByRepo(repoId)` — total doc count for "N of M attached" UI
- `isScanRunning(repoId)` — check jobs table for active context-scan

**File (NEW):** `server/src/modules/project-context/scanner.ts`

Pure scanning logic, separated from service for testability:
- `scanDirectory(clonePath, globs)` — uses `fast-glob` (must be added:
  `pnpm add fast-glob`). No glob library currently exists in server dependencies.
- `categorizeFile(path, matchedGlob)` — determine category per AC-U4
- `countTokens(content)` — `content.split(/\s+/).length * 1.3 | 0`
- `validateFilename(name)` — regex `^[a-zA-Z0-9_-]+\.md$`, no `../`
- `validateContent(content)` — max 500KB, valid UTF-8

**File (NEW):** `server/src/modules/project-context/helpers.ts`

Shared constants and Zod schemas for route validation:
- `RepoIdParams` (`:repoId` uuid)
- `DocIdParams` (`:repoId` + `:docId` uuids)
- `CreateDocBody`, `UpdateContentBody`, `CreateFolderBody`
- `SetContextBody` (for PUT /agents/:id/context and /skills/:id/context)
- `MAX_ATTACHED_DOCS = 10`
- `MAX_FILE_SIZE = 500 * 1024`
- `DEFAULT_GLOBS = ['**/specs/**/*.md', '**/docs/**/*.md', '**/INSIGHTS.md']`

**File (EDIT):** `server/src/modules/index.ts`

Add import and registry entry:
```ts
import projectContext from './project-context/routes.js';
// ...
projectContext,
```

**ACs covered:** AC-U4, AC-U5, AC-U6, AC-U7, AC-E1 through AC-E13,
AC-X1 through AC-X7

---

### Step 2.2: Install `@fastify/multipart`

**Command:** `cd server && pnpm add @fastify/multipart`

**File (EDIT):** `server/src/app.ts` (or inside `routes.ts` as a local register)

Register the multipart plugin. Prefer registering it locally inside the
project-context routes plugin to avoid affecting other routes:
```ts
import multipart from '@fastify/multipart';
// Inside the plugin:
await app.register(multipart, { limits: { fileSize: 500 * 1024 } });
```

**ACs covered:** AC-E7 (upload route), spec API surface (POST `.../upload`)

---

### Step 2.3: Scan job registration

**File:** `server/src/modules/project-context/routes.ts`

Register a new job kind `context-scan` on the container's `JobRunner`:
```ts
container.jobs.register('context-scan', async (payload, ctx) => {
  const { workspaceId, repoId } = payload as { workspaceId: string; repoId: string };
  await service.scan(workspaceId, repoId);
});
```

The `POST /repos/:repoId/context/scan` route:
1. Checks and enqueues atomically to avoid TOCTOU race conditions.
   Use `isScanRunning(repoId)` — if true, return 409. To prevent two
   concurrent requests both passing the check before either inserts, wrap
   the check + enqueue in a single DB transaction, OR add a unique partial
   index on the `jobs` table: `CREATE UNIQUE INDEX jobs_context_scan_active
   ON jobs (kind, (payload->>'repoId')) WHERE kind = 'context-scan'
   AND status IN ('queued', 'running')` — this makes the second insert fail
   with a constraint violation, caught and mapped to 409.
2. On success, returns 202 with `{ jobId }`.

**ACs covered:** AC-E1, AC-E2, AC-S2, edge case #12

---

### Step 2.4: Path traversal security

All file read/write/create/delete operations in `service.ts` must:
1. Resolve the final absolute path via `path.resolve(clonePath, relativePath)`.
2. Verify the resolved path starts with the repo's `clonePath`.
3. Reject with 400 if traversal is detected.

The `scanner.ts` `validateFilename()` rejects `../` sequences and enforces the
`^[a-zA-Z0-9_-]+\.md$` pattern.

**ACs covered:** AC-U6, AC-X5, untrusted-input table

---

## Phase 3 — Review pipeline integration (server)

### Step 3.1: Context merge in service

**File:** `server/src/modules/project-context/service.ts`

Implement `resolveContextForAgent(agentId, repoId)`:

```
Input:  agentId, repoId
Output: Array<{ path, category, tokens, content }>

1. Query agent_context_docs JOIN context_docs
   WHERE agent_id = :agentId
   ORDER BY agent_context_docs.order ASC
   -> agentDocs[]

2. Query agent_skills JOIN skills
   WHERE agent_skills.agent_id = :agentId
     AND skills.enabled = true            ← three-way join required
   ORDER BY agent_skills.order ASC
   -> enabledSkills[]

3. For each skill in enabledSkills (in order):
     Query skill_context_docs JOIN context_docs
     WHERE skill_id = :skillId
     ORDER BY skill_context_docs.order ASC
     -> append to skillDocs[]

4. Merge: result = agentDocs ++ skillDocs

5. Deduplicate by path (first occurrence wins)

6. For each doc: read content from disk (clone_path + doc.path)
   - If file is missing on disk (ENOENT): SKIP the doc, log a warning
     via onEvent/runLog ("context doc missing: {path}, skipping").
     Do NOT crash the entire review run for a missing context file.
   - Still include the doc in specs_read with tokens=0 so the trace
     shows it was expected but unavailable.

7. Return the array (only docs with successfully read content)
```

**Repository query note:** Step 2 requires a three-way join through
`agent_skills` → `skills` (to check `skills.enabled`) → `skill_context_docs`
→ `context_docs`. The `enabled` column lives on the `skills` table
(`server/src/db/schema/skills.ts:17`), NOT on `agent_skills`. The repository
must join through `skills` to filter, not just query `agent_skills` directly.

**ACs covered:** AC-E10, edge cases #3, #9, #10, #11

---

### Step 3.2: Wire into run-executor

**File (EDIT):** `server/src/modules/reviews/run-executor.ts`

In `runOneAgent()`, after resolving skills (~line 206) and before calling
`reviewPullRequest()` (~line 212):

1. Import `ProjectContextService` (or its `resolveContextForAgent` method).
2. Call `resolveContextForAgent(agent.id, repo.id)`.
3. If context docs are returned, pass them as `specs: contextDocs.map(d => d.content)`.
4. Build the enriched `specs_read` array: `contextDocs.map(d => ({ path: d.path, category: d.category, tokens: d.tokens }))`.
5. Replace the hardcoded `specs_read: []` (line 322) with the enriched array.

The `reviewPullRequest()` call gains:
```ts
...(contextSpecs.length > 0 ? { specs: contextSpecs } : {}),
```

The success-path trace object (~line 322) gains:
```ts
specs_read: specsReadEntries,  // was: []
```

6. **Failure-path trace (explicit sub-step):** Also update `traceFromBuffer()`
   (~line 510) which hardcodes `specs_read: []`. The `specsReadEntries` array
   must be computed BEFORE the `reviewPullRequest()` call and stored in a
   variable scoped to `runOneAgent()`, so it's available in both success and
   failure paths. In the failure path, pass the same enriched array (the context
   was resolved even if the review itself failed).

**File (EDIT):** `server/src/platform/trace-builder.ts`

This file is a **second write path** used by CI agents. It must also be updated:

1. Change `BuildTraceInput.specsRead` type from `string[]` to
   `Array<string | SpecReadEntry>` (matching the union schema).
2. Import `SpecReadEntry` from `@devdigest/shared`.
3. The `buildRunTrace()` function calls `RunTraceSchema.parse(trace)` at
   line 56 — the union schema will accept both old string arrays (from
   existing CI callers) and new enriched arrays. No other changes needed.

**Add to edited files inventory:** `server/src/platform/trace-builder.ts`

**ACs covered:** AC-U4a, AC-E10

---

## Phase 4 — Client: Navigation & Project Context page

### Step 4.1: Sidebar navigation

**File (EDIT):** `client/src/vendor/ui/nav.ts`

Add a new nav item to the WORKSPACE section:
```ts
{
  key: "context",
  label: "Project Context",
  icon: "FileText",
  href: "/repos/:repoId/project-context",
  gKey: "x",
}
```

Add corresponding shortcut entry to `SHORTCUTS`.

**ACs covered:** AC-O1

---

### Step 4.2: API hooks

**File (NEW):** `client/src/lib/hooks/project-context.ts`

TanStack Query hooks:
- `useContextDocs(repoId, search?)` — GET `/repos/:repoId/context/docs`
- `useContextDoc(repoId, docId)` — GET `.../docs/:docId`
- `useContextDocContent(repoId, docId)` — GET `.../docs/:docId/content`
- `useScanContextDocs(repoId)` — POST `.../context/scan` (mutation)
- `useUpdateContextDocContent(repoId, docId)` — PUT `.../docs/:docId/content` (mutation)
- `useCreateContextDoc(repoId)` — POST `.../docs` (mutation)
- `useDeleteContextDoc(repoId)` — DELETE `.../docs/:docId` (mutation)
- `useUploadContextDoc(repoId)` — POST `.../docs/upload` (mutation, FormData)
- `useCreateContextFolder(repoId)` — POST `.../folders` (mutation)
- `useAgentContext(agentId)` — GET `/agents/:agentId/context`
- `useSetAgentContext(agentId)` — PUT `/agents/:agentId/context` (mutation)
- `useSkillContext(skillId)` — GET `/skills/:skillId/context`
- `useSetSkillContext(skillId)` — PUT `/skills/:skillId/context` (mutation)

**File (EDIT):** `client/src/lib/hooks/index.ts`

Re-export from `./project-context.js`.

**Note on upload mutation — FormData content-type handling:**

The `apiFetch` helper (`client/src/lib/api.ts:21-32`) sets
`content-type: application/json` whenever `init?.body != null`. Since `FormData`
is non-null, this header WILL be set incorrectly — Fastify will reject the
request because the body isn't JSON.

Passing `headers: {}` does NOT fix this — an empty object spread doesn't
override the already-set JSON header.

**Required fix:** Create a small `apiUpload()` helper in `client/src/lib/api.ts`:
```ts
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
    // Do NOT set content-type — browser auto-sets multipart/form-data with boundary
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}
```

The upload mutation hook should call `apiUpload` instead of `apiFetch`.

**Add to edited files inventory:** `client/src/lib/api.ts`

---

### Step 4.3: Project Context page

**File (NEW):** `client/src/app/repos/[repoId]/project-context/page.tsx`

Thin page entry point. Imports and renders `ProjectContextView`.

**Directory (NEW):** `client/src/app/repos/[repoId]/project-context/_components/`

**File (NEW):** `_components/ProjectContextView/ProjectContextView.tsx`

Two-panel layout:
- **Left panel:** File list with toolbar (create, folder, upload, refresh/scan).
  Search input for filename filtering. Each item shows filename + icon.
  Footer: "Indexed: N files" + last scan timestamp.
- **Right panel:** Preview/Edit toggle. Preview mode renders markdown via
  `react-markdown`. Edit mode is a plain `<textarea>` with a Save button.

**File (NEW):** `_components/ProjectContextView/styles.ts`

CSSProperties objects following the project convention (inline styles with CSS variables).

**File (NEW):** `_components/CreateDocModal/CreateDocModal.tsx`

Dialog for creating a new file: directory dropdown (specs/docs/insights) + filename input.

**File (NEW):** `_components/UploadDocModal/UploadDocModal.tsx`

Dialog for uploading a `.md` file: directory dropdown + file input. Submits as FormData.

**File (NEW):** `_components/CreateFolderModal/CreateFolderModal.tsx`

Dialog for creating a folder: directory dropdown + folder name input.

**File (NEW):** `_components/EmptyState/EmptyState.tsx`

"No spec files yet" centered message with "+ Add a spec file" CTA button.

**ACs covered:** AC-E2, AC-E3, AC-E4, AC-E5, AC-E6, AC-E7, AC-E13,
AC-S1, AC-S2, AC-S3, AC-X2, AC-X3, AC-X4, AC-X5, AC-X6

---

### Step 4.4: Unsaved changes indicator

In the edit mode of `ProjectContextView`, track whether the textarea content
differs from the fetched content. When dirty, show a visual indicator (e.g.
dot next to filename, modified title styling). Warn on navigation away
(optional: `beforeunload` handler).

**ACs covered:** AC-S1

---

## Phase 5 — Client: Agent & Skill context tabs

### Step 5.1: Agent detail — Context tab

**File (EDIT):** `client/src/app/agents/[id]/page.tsx`

Add `"context"` to the `VALID_TABS` array.

**File (NEW):** `client/src/app/agents/[id]/_components/AgentContextTab/AgentContextTab.tsx`

Rendered when `tab === "context"`. Shows:
- Header: "Project context" + "N of M attached"
- Instruction text about ordering
- Document list with: drag handle (for reorder), filename, path, category badge,
  attach/detach toggle, "Preview" button
- Footer: combined token count + injection note

Uses `useAgentContext(agentId)` for data, `useSetAgentContext(agentId)` for
mutations. Drag-to-reorder via HTML5 drag-and-drop or a lightweight library
(e.g. `@dnd-kit/core` if already available, otherwise plain drag events).

Enforces `MAX_ATTACHED_DOCS = 10` client-side (disable toggle when at limit).

**File (NEW):** `client/src/app/agents/[id]/_components/AgentContextTab/styles.ts`

**ACs covered:** AC-O2, AC-E8, AC-E11, AC-U7

---

### Step 5.2: Skill detail — Context tab

**File (EDIT):** `client/src/app/skills/page.tsx` (or skill detail page if it exists)

Add a "Context" section or tab to the skill editor.

**File (NEW):** `client/src/app/skills/_components/SkillContextSection/SkillContextSection.tsx`

Similar to the agent context tab but simpler: checkbox-based attach/detach,
no drag-to-reorder (or optional). Shows "Attached" / "All documents" toggle.

**ACs covered:** AC-E9

---

## Phase 6 — Client: Run trace update

### Step 6.1: Update TraceBody for enriched `specs_read`

**File (EDIT):** `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`

The current code renders `trace.specs_read` as plain strings:
```tsx
trace.specs_read.map((sp) => (
  <span key={sp} className="mono" style={s.spec}>{sp}</span>
))
```

Update to render the enriched objects. **Must handle the union type** — old
traces may contain plain strings (from before this feature), new traces contain
objects. Normalize before rendering:

```tsx
trace.specs_read.map((sp) => {
  const entry = typeof sp === 'string'
    ? { path: sp, category: 'other' as const, tokens: 0 }
    : sp;
  return (
    <div key={entry.path} style={s.specEntry}>
      <span className="mono" style={s.specPath}>{entry.path}</span>
      <Badge color="var(--text-muted)" style={s.specCategory}>{entry.category}</Badge>
      <span style={s.specTokens}>{entry.tokens} tokens</span>
    </div>
  );
})
```

Add new styles to the adjacent `styles.ts` for `specEntry`, `specPath`,
`specCategory`, `specTokens`.

Consider adding a total token count at the bottom of the specs section.

**ACs covered:** AC-U4a (client rendering of enriched trace)

---

## Phase 7 — Tests

### Step 7.1: Server unit tests

**File (NEW):** `server/src/modules/project-context/scanner.test.ts`

- Token counting accuracy
- Filename validation (valid, invalid, traversal)
- Category classification from glob patterns
- Content size validation

**File (NEW):** `server/src/modules/project-context/service.test.ts`

- Context merge algorithm: agent-only, skill-only, mixed, deduplication
- Path traversal rejection
- Max attachment limit enforcement
- 409 on concurrent scan

### Step 7.2: Server integration tests

**File (NEW):** `server/src/modules/project-context/routes.it.test.ts`

- Full CRUD lifecycle: scan → list → read → edit → save → delete
- Upload via multipart
- Attach/detach to agent and skill
- Reorder attached docs
- Concurrent scan returns 409
- Path traversal returns 400
- File not on disk returns appropriate error

### Step 7.3: Client component tests

**File (NEW):** `client/src/app/repos/[repoId]/project-context/_components/ProjectContextView/ProjectContextView.test.tsx`

- Renders file list from mock data
- Search filtering
- Empty state shown when no docs
- Preview/edit toggle
- Unsaved changes indicator

**File (NEW):** `client/src/app/agents/[id]/_components/AgentContextTab/AgentContextTab.test.tsx`

- Renders attached vs available docs
- Toggle attach/detach
- "N of M attached" label
- Token total

---

## Dependency graph

```
Phase 1 (data layer)
  ├── Step 1.1: shared contract
  ├── Step 1.2: DB schema
  └── Step 1.3: migration
        │
Phase 2 (server module) ← depends on Phase 1
  ├── Step 2.1: module skeleton
  ├── Step 2.2: install @fastify/multipart
  ├── Step 2.3: scan job
  └── Step 2.4: path security
        │
Phase 3 (pipeline) ← depends on Phase 2
  ├── Step 3.1: merge algorithm
  └── Step 3.2: run-executor wiring
        │
Phase 4 (client: page) ← depends on Phase 1 (contracts) + Phase 2 (API)
  ├── Step 4.1: sidebar nav
  ├── Step 4.2: API hooks
  ├── Step 4.3: Project Context page
  └── Step 4.4: unsaved indicator
        │
Phase 5 (client: tabs) ← depends on Phase 4.2
  ├── Step 5.1: agent context tab
  └── Step 5.2: skill context section
        │
Phase 6 (client: trace) ← depends on Phase 1.1 (contract change)
  └── Step 6.1: TraceBody update

Phase 7 (tests) ← depends on all above
```

Phases 4 and 6 can proceed in parallel with Phase 3 once Phase 2 is complete.
Phase 6 only depends on Phase 1.1 (the contract change) and can start early.

## File inventory

### New files (18)

| # | Path | Purpose |
|---|------|---------|
| 1 | `server/src/vendor/shared/contracts/context-doc.ts` | SpecReadEntry + ContextDocCategory schemas |
| 2 | `client/src/vendor/shared/contracts/context-doc.ts` | Mirror of above |
| 3 | `server/src/db/schema/project-context.ts` | Drizzle tables: context_docs, agent_context_docs, skill_context_docs |
| 4 | `server/src/db/migrations/0012_*.sql` | Generated migration |
| 5 | `server/src/modules/project-context/routes.ts` | Fastify plugin with all routes |
| 6 | `server/src/modules/project-context/service.ts` | Business logic |
| 7 | `server/src/modules/project-context/repository.ts` | Drizzle queries |
| 8 | `server/src/modules/project-context/scanner.ts` | File scanning + validation logic |
| 9 | `server/src/modules/project-context/helpers.ts` | Zod schemas, constants |
| 10 | `client/src/lib/hooks/project-context.ts` | TanStack Query hooks |
| 11 | `client/src/app/repos/[repoId]/project-context/page.tsx` | Page entry |
| 12 | `client/src/app/repos/[repoId]/project-context/_components/ProjectContextView/ProjectContextView.tsx` | Main two-panel view |
| 13 | `client/src/app/repos/[repoId]/project-context/_components/CreateDocModal/CreateDocModal.tsx` | Create file dialog |
| 14 | `client/src/app/repos/[repoId]/project-context/_components/UploadDocModal/UploadDocModal.tsx` | Upload file dialog |
| 15 | `client/src/app/repos/[repoId]/project-context/_components/CreateFolderModal/CreateFolderModal.tsx` | Create folder dialog |
| 16 | `client/src/app/repos/[repoId]/project-context/_components/EmptyState/EmptyState.tsx` | Empty state |
| 17 | `client/src/app/agents/[id]/_components/AgentContextTab/AgentContextTab.tsx` | Agent context tab |
| 18 | `client/src/app/skills/_components/SkillContextSection/SkillContextSection.tsx` | Skill context section |

### Edited files (10)

| # | Path | Change |
|---|------|--------|
| 1 | `server/src/vendor/shared/contracts/trace.ts` | Import SpecReadEntry, change `specs_read` to union type |
| 2 | `client/src/vendor/shared/contracts/trace.ts` | Same mirror change |
| 3 | `server/src/db/schema.ts` | Add exports + schema entries for 3 new tables |
| 4 | `server/src/modules/index.ts` | Register projectContext module |
| 5 | `server/src/modules/reviews/run-executor.ts` | Wire context resolution + enriched specs_read (both success and failure paths) |
| 6 | `server/src/platform/trace-builder.ts` | Update `specsRead` type to accept union, import SpecReadEntry |
| 7 | `client/src/vendor/ui/nav.ts` | Add "Project Context" nav item |
| 8 | `client/src/lib/hooks/index.ts` | Re-export project-context hooks |
| 9 | `client/src/lib/api.ts` | Add `apiUpload()` helper for FormData requests |
| 10 | `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx` | Render enriched specs_read with union normalization |

### Dependencies added (2)

| Package | Where | Why |
|---------|-------|-----|
| `@fastify/multipart` | `server/package.json` | File upload endpoint |
| `fast-glob` | `server/package.json` | Scanner glob pattern matching (no glob lib exists in server) |

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `trace.ts` edit breaks old traces with string `specs_read` | Medium | Union schema `z.union([z.string(), SpecReadEntry])` accepts both formats. Test fixture at `contracts.test.ts:168` validated. TraceBody normalizes at render time. |
| `trace-builder.ts` callers pass old `string[]` format | Medium | Union type in `BuildTraceInput.specsRead` accepts both. `RunTraceSchema.parse()` validates. |
| Cross-workspace context doc attachment | Medium | Explicit workspace ownership check in `setAgentDocs`/`setSkillDocs` before insert. |
| TOCTOU race on concurrent scan 409 | Low | Atomic check+enqueue via transaction or partial unique index on jobs table. |
| Missing file during context merge crashes review | Medium | `resolveContextForAgent` catches ENOENT per-file, skips with warning, continues. |
| Scanner performance on large repos | Low | Glob patterns are narrow (`**/specs/**/*.md`, etc.). Token counting is O(n) string split. 500-file cap in NFR is generous. |
| Multipart plugin conflicts with other routes | Low | Register locally inside project-context plugin, not globally. |
| Agent context tab reorder UX complexity | Medium | Start with simple move-up/move-down buttons; upgrade to drag-and-drop in follow-up if needed. |
| `vendor/shared/` mirror drift between server/client | Medium | Both files created from same source in same step. CI typecheck catches drift. |

## Estimated effort

| Phase | Effort |
|-------|--------|
| Phase 1: Data layer | Small (1-2 hours) |
| Phase 2: Server module | Large (4-6 hours) |
| Phase 3: Pipeline integration | Small (1-2 hours) |
| Phase 4: Client page | Large (4-6 hours) |
| Phase 5: Client tabs | Medium (2-3 hours) |
| Phase 6: Client trace | Small (30 min) |
| Phase 7: Tests | Medium (2-3 hours) |
| **Total** | **~15-22 hours** |
