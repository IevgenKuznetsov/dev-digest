# Spec: Project Context

Spec ID: ProjectContext_1
Status: draft
Supersedes: ---

## Problem and User

DevDigest agents review PRs, but they lack project-specific grounding. An agent
reviewing a PR against a payments API has no idea that the team wrote a
"public-api.md" spec mandating rate-limiting on all public endpoints, or a
"security-baseline.md" doc requiring SSRF validation. Without this grounding,
reviews produce generic advice instead of project-relevant findings.

The **agent administrator** (the person who configures agents and skills) needs a
way to:

1. Discover markdown context files that already exist in the repository
   (specs, docs, INSIGHTS.md, etc.).
2. Browse and edit those files within DevDigest.
3. Attach specific context documents to agents and/or skills so that the review
   engine injects them into the prompt.
4. See exactly which documents were injected (and their token cost) in the run
   trace after a review completes.

## Goals / Non-goals

### Goals

- Provide a file scanner that discovers `.md` files under configurable glob
  patterns in the cloned repository and persists metadata (path, category,
  token count) in the database. Glob patterns are configurable per-repo in
  settings; defaults are `**/specs/**/*.md`, `**/docs/**/*.md`, and
  `**/INSIGHTS.md`.
- Expose a "Project Context" page in the client where users can browse, search,
  preview, edit, create, and delete context documents.
- Allow attaching context documents to agents and skills via two join tables,
  with a deterministic merge strategy at review time (agent-level docs first,
  then skill docs in skill order, deduplicated by path).
- Enrich the `specs_read` field in `RunTrace` from a flat string array to an
  array of objects carrying `path`, `category`, and `tokens`, giving full
  transparency in the run trace.
- Show context attachment UI on the agent detail page ("Context" tab) with
  drag-to-reorder, toggle attach/detach, and a combined token total.
- Show context documents used in the run trace panel on the PR detail page.

### Non-goals

- **Auto-attaching documents to agents based on content similarity.** Attachment
  is always an explicit manual action for v1.
- **Rich text / WYSIWYG editing.** The editor is a plain textarea. CodeMirror or
  similar is deferred to a future iteration.
- **Category-based filtering in the file list.** Only substring search on
  filename is supported for v1.
- **Periodic/timer-based scanning.** The scanner runs on explicit triggers only
  (repo sync, manual refresh, first load with no data).
- **Conflict detection or locking for concurrent edits.** Last-write-wins is
  acceptable for v1.
- **Editing files that are not discovered by the scanner.** Users can only edit
  files matching the configured glob patterns.
- **`insights/` as a directory.** Insights is a single file (`INSIGHTS.md`),
  not a directory tree. The scanner matches it by filename, not by directory.

## User stories

- As an agent administrator, I want to see all markdown context files in my
  repository so that I know what grounding material is available.
- As an agent administrator, I want to preview a context file's rendered
  markdown so that I can verify its content before attaching it to an agent.
- As an agent administrator, I want to edit a context file in-place so that I
  can fix or update project specs without leaving DevDigest.
- As an agent administrator, I want to create new context files (specs, docs,
  insights) so that I can author grounding material directly in DevDigest.
- As an agent administrator, I want to attach context documents to a specific
  agent so that its reviews are grounded in project-specific requirements.
- As an agent administrator, I want to attach context documents to a specific
  skill so that any agent using that skill automatically receives the skill's
  context.
- As an agent administrator, I want to see the combined token count of all
  attached documents so that I can manage prompt budget.
- As an agent administrator, I want to reorder attached documents so that the
  most important context appears first in the prompt.
- As an agent administrator, I want to see "2 of 7 attached" on the agent
  context tab so I know at a glance how much context is configured vs available.
- As a reviewer (any user viewing a PR), I want the run trace to show which
  context documents were injected and their individual token counts so that I
  can understand what grounding the agent had.

## Acceptance criteria (EARS)

### Ubiquitous (always true, no trigger)

- AC-U1: The system shall store context document metadata in a `context_docs`
  table with columns: `id` (uuid PK), `repo_id` (FK to repos), `workspace_id`
  (FK to workspaces), `path` (text, relative to repo root), `category`
  (enum: specs, docs, insights, other), `tokens` (integer), `scanned_at`
  (timestamptz), `created_at` (timestamptz).

- AC-U2: The system shall maintain an `agent_context_docs` join table with
  columns: `agent_id` (FK to agents), `context_doc_id` (FK to context_docs),
  `order` (integer), with composite PK on (agent_id, context_doc_id).

- AC-U3: The system shall maintain a `skill_context_docs` join table with
  columns: `skill_id` (FK to skills), `context_doc_id` (FK to context_docs),
  `order` (integer), with composite PK on (skill_id, context_doc_id).

- AC-U4: The system shall determine the document category as follows: files
  matched by a glob containing `specs` → "specs", files matched by a glob
  containing `docs` → "docs", files named `INSIGHTS.md` (any depth) →
  "insights", all others → "other".

- AC-U4a: The system shall represent `specs_read` in the `RunTrace` contract as
  `z.array(z.object({ path: z.string(), category: z.enum(['specs', 'docs', 'insights', 'other']), tokens: z.number() }))`.

- AC-U5: The system shall restrict file creation to the `specs/` or `docs/`
  directories only. `INSIGHTS.md` is a single file, not a directory — users
  can create it at any level but cannot create subdirectories for it.

- AC-U6: The system shall validate that created/renamed filenames end in `.md`,
  contain only alphanumeric characters, hyphens, and underscores (plus the
  extension), and contain no path traversal sequences (`../`).

- AC-U7: The system shall enforce a maximum of 10 context documents attached
  per agent or skill. Attempts to attach beyond this limit shall be rejected
  with a validation error.

### Event-Driven (triggered by an event)

- AC-E1: When a repository is synced or cloned, the system shall automatically
  scan the repository clone directory for files matching the configured glob
  patterns and upsert their metadata (path, category, token count) into the
  `context_docs` table.

- AC-E2: When the user clicks the refresh button on the Project Context page,
  the system shall re-scan the repository and update all context document
  metadata, including recalculated token counts.

- AC-E3: When the user navigates to the Project Context page and no scan data
  exists for the active repository, the system shall trigger an initial scan
  automatically.

- AC-E4: When the user selects a context document in the file list, the system
  shall display a rendered markdown preview of the file content in the main
  panel.

- AC-E5: When the user clicks "Edit" on a context document, the system shall
  display a plain textarea containing the raw markdown content with an explicit
  "Save" button.

- AC-E6: When the user saves an edited context document, the system shall write
  the content to disk (in the repo clone), recalculate the token count, and
  update the database record.

- AC-E7: When the user clicks the "+" (create) button, the system shall display
  a creation dialog where the user selects a target directory (specs, docs, or
  insights) via dropdown and enters a filename.

- AC-E8: When a context document is attached to or detached from an agent, the
  system shall insert or delete the corresponding row in `agent_context_docs`
  and update the displayed attachment count and token total.

- AC-E9: When a context document is attached to or detached from a skill, the
  system shall insert or delete the corresponding row in `skill_context_docs`.

- AC-E10: When a review run is executed, the system shall resolve the effective
  context document set by: (1) collecting agent-level docs ordered by
  `agent_context_docs.order`, (2) appending skill-level docs for each linked
  skill in `agent_skills.order` then `skill_context_docs.order`, (3)
  deduplicating by path (first occurrence wins), (4) reading each file's content
  from disk, and (5) recording the enriched `specs_read` array (path, category,
  tokens) in the run trace.

- AC-E11: When the user reorders attached documents on the agent context tab,
  the system shall persist the new order values in `agent_context_docs.order`.

- AC-E12: When a re-scan finds files on disk that no longer exist, the system
  shall remove the corresponding `context_docs` rows (cascading to join tables).

- AC-E13: When the user creates a new folder via the folder creation button, the
  system shall create the directory on disk within the allowed context
  directories (specs/, docs/, insights/).

### State-Driven (true while a condition holds)

- AC-S1: While a context document has unsaved edits in the editor, the system
  shall display an unsaved-changes indicator (visual badge or modified title).

- AC-S2: While the file scanner is running, the system shall display a scanning
  indicator in the Project Context page toolbar status area.

- AC-S3: While no context documents exist for the active repository (empty
  state), the system shall display the empty state view with the message
  "No spec files yet" and a call-to-action button "+ Add a spec file".

### Optional Feature (conditional on feature presence)

- AC-O1: Where the Project Context module is registered, the system shall
  expose a "Project Context" navigation item in the sidebar under the
  WORKSPACE section.

- AC-O2: Where an agent has context documents attached, the agent detail page
  shall display a "Context" tab showing the attached documents with their
  categories, token counts, and drag handles for reordering.

### Unwanted Behavior (error/fault handling)

- AC-X1: If the repository clone directory does not exist when a scan is
  triggered, then the system shall return an appropriate error and not create
  any `context_docs` rows.

- AC-X2: If a context document's file has been deleted from disk but its
  database record still exists, then the system shall gracefully handle the
  missing file during preview/edit by showing an error message ("File not found
  on disk -- run a re-scan") rather than crashing.

- AC-X3: If the user attempts to create a file with a name that already exists
  at the target path, then the system shall reject the creation with a
  validation error ("File already exists").

- AC-X4: If the user attempts to save a file with content that exceeds a
  reasonable size limit (e.g., 500 KB), then the system shall reject the save
  with a validation error.

- AC-X5: If a filename fails validation (missing .md extension, contains path
  traversal, invalid characters), then the system shall reject the
  create/rename with a descriptive validation error.

- AC-X6: If the file write to disk fails (permissions, disk full), then the
  system shall return a 500 error with a descriptive message and not update the
  database record.

- AC-X7: If a context document referenced in `agent_context_docs` or
  `skill_context_docs` is deleted (by re-scan removing it), then the join table
  rows shall be cascade-deleted via the FK constraint.

## Edge cases

| # | Scenario | Expected behavior |
|---|----------|-------------------|
| 1 | Repository has no `.md` files matching the glob patterns | Scanner completes successfully, `context_docs` table has zero rows for this repo, Project Context page shows empty state |
| 2 | A file attached to 3 agents is deleted from disk, then a re-scan runs | The `context_docs` row is deleted, cascading to all 3 `agent_context_docs` rows. Each agent's attachment count decreases by 1. |
| 3 | Two agents share the same skill, and the skill has 2 context docs attached. Both agents also have the same 2 docs attached directly. | At review time, deduplication by path ensures each doc appears only once. The agent-level ordering takes precedence (agent docs come first). |
| 4 | User edits a file, increasing its size substantially, causing the token count to jump | On save, token count is recalculated and the new value is persisted. The combined token total on any agent context tab updates on next fetch. |
| 5 | User creates a file named `../../etc/passwd.md` | Filename validation rejects the path traversal pattern. Error message displayed. |
| 6 | Scanner runs while user is editing a file | The scan updates metadata (token count, scanned_at) in the DB. The user's in-progress edits in the textarea are not affected (they are client-side state). On save, the user's content overwrites what is on disk (last-write-wins). |
| 7 | Repository clone path is stale (repo was re-cloned to a different path) | The scanner uses the current `repos.clone_path` value, so it reads from the correct location. If clone_path is null, the scan fails gracefully per AC-X1. |
| 8 | File contains frontmatter or non-standard markdown | The preview renders it as-is (react-markdown). No special frontmatter parsing for v1. |
| 9 | Agent has 0 skills but 5 context docs attached; review runs | Only the 5 agent-level docs are injected. No skill docs to merge. |
| 10 | Skill has context docs but is disabled (`enabled = false`) on the agent | The disabled skill's context docs are excluded from the merge at review time. Only docs from enabled skills are included. |
| 11 | The same file is attached to a skill at order 1 and the agent at order 3 | The agent-level attachment (order 3) takes precedence since agent docs are processed first. The duplicate from the skill is skipped during dedup. |
| 12 | User clicks refresh while a scan is already in progress | The second scan request is either queued or rejected with a 409. No concurrent scans for the same repo. |

## Non-functional requirements

- **Performance**: File scanning should complete within 10 seconds for
  repositories with up to 500 matching `.md` files. Token counting uses a
  simple word-based heuristic (`content.split(/\s+/).length * 1.3`), computed
  synchronously during scan. No external tokenizer library. The file list API
  should return in under 200ms for up to 500 documents.
- **Security**: All file paths must be validated to prevent path traversal
  outside the repository clone directory. File content is read from disk and
  served via the API -- the API must not serve files outside `server/clones/`.
  All endpoints are workspace-scoped via `getContext()`. File creation is
  restricted to the three allowed directories (specs/, docs/, insights/).
- **Accessibility**: The file list, preview/edit toggle, and attachment
  checkboxes should be keyboard-navigable. The textarea editor should receive
  focus automatically when entering edit mode.

## Inputs and provenance

| Input | Source | Format |
|-------|--------|--------|
| Repository clone directory | `repos.clone_path` column in DB | Filesystem path (e.g., `server/clones/{repoId}`) |
| Glob patterns for scanning | Per-repo setting; defaults: `**/specs/**/*.md`, `**/docs/**/*.md`, `**/INSIGHTS.md`. Configurable in repo settings. | Glob string array |
| File content | Filesystem read from repo clone | Raw UTF-8 text |
| Agent ID for attachment | Client request / URL param | UUID string |
| Skill ID for attachment | Client request / URL param | UUID string |
| Context doc ID for attachment | Client request body | UUID string |
| Search filter text | User input in Project Context page | Free-text string (substring match on filename) |
| New file name | User input in creation dialog | String, validated per AC-U6 |
| Target directory | User selection in creation dialog dropdown | Enum: `specs` / `docs` / `insights` |
| File content for save | User input in textarea editor | Raw text (markdown) |

## Untrusted inputs

| Input | Risk | Validation |
|-------|------|------------|
| File path in API requests (read/edit/delete) | Path traversal to read/write files outside clone directory | Resolve to absolute path, verify it starts with the repo's `clone_path`. Reject `../` sequences. Validate against the known `context_docs` paths in DB. |
| New filename in creation dialog | Path traversal, special characters, overwriting critical files | Must match `^[a-zA-Z0-9_-]+\.md$`. Must not contain `..`. Target directory must be one of specs/docs/insights. Check for existing file at target path. |
| File content on save | Excessively large content, binary data | Enforce max size (500 KB). Verify content is valid UTF-8 text. |
| Search filter text | XSS if rendered unsanitized | Filter is applied server-side as a SQL ILIKE or client-side substring match. No raw HTML rendering of the filter value. |
| Context doc IDs in attach/detach requests | Referencing docs from another workspace | Verify the context_doc belongs to the same workspace as the agent/skill. FK constraints provide a safety net but explicit checks should occur at the route level. |
| Order values in reorder requests | Non-integer or negative values | Validate as positive integers via Zod schema. |

## API surface

All routes are workspace-scoped via `getContext()`. The module is registered in
`server/src/modules/index.ts` as `projectContext`.

### Context document discovery and management

| Method | Path | Description |
|--------|------|-------------|
| POST | `/repos/:repoId/context/scan` | Trigger a file scan for the repository. Returns the updated list of context docs. |
| GET | `/repos/:repoId/context/docs` | List all context documents for a repo. Supports `?search=` query param for filename substring filtering. |
| GET | `/repos/:repoId/context/docs/:docId` | Get a single context document's metadata. |
| GET | `/repos/:repoId/context/docs/:docId/content` | Read the file content from disk. Returns raw markdown text. |
| PUT | `/repos/:repoId/context/docs/:docId/content` | Write updated content to disk. Recalculates token count. |
| POST | `/repos/:repoId/context/docs` | Create a new context file. Body: `{ directory: 'specs' | 'docs' | 'insights', filename: string, content?: string }`. |
| DELETE | `/repos/:repoId/context/docs/:docId` | Delete a context file from disk and DB. |
| POST | `/repos/:repoId/context/docs/upload` | Upload a `.md` file from user's machine into a context directory. Multipart form: file + `directory` field (`specs` or `docs`). |

### Context document attachments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/agents/:agentId/context` | List context docs attached to an agent, ordered by `order`. Also returns total count of available docs for the repo. |
| PUT | `/agents/:agentId/context` | Replace the full set of attached docs with ordering. Body: `{ docs: Array<{ contextDocId: string, order: number }> }`. |
| GET | `/skills/:skillId/context` | List context docs attached to a skill, ordered by `order`. |
| PUT | `/skills/:skillId/context` | Replace the full set of attached docs for a skill with ordering. Body: `{ docs: Array<{ contextDocId: string, order: number }> }`. |

### Folder management

| Method | Path | Description |
|--------|------|-------------|
| POST | `/repos/:repoId/context/folders` | Create a new folder. Body: `{ directory: 'specs' | 'docs' | 'insights', name: string }`. |

## Data model changes

### New table: `context_docs`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | uuid | PK, default random |
| `workspace_id` | uuid | FK to workspaces, cascade delete, not null |
| `repo_id` | uuid | FK to repos, cascade delete, not null |
| `path` | text | Relative path from repo root, not null |
| `category` | text (enum) | `specs` / `docs` / `insights` / `other`, not null |
| `tokens` | integer | Token count of file content, not null |
| `scanned_at` | timestamptz | Last scan timestamp, not null |
| `created_at` | timestamptz | Row creation time, default now(), not null |

Indexes: unique on `(repo_id, path)`, index on `(repo_id)`.

### New table: `agent_context_docs`

| Column | Type | Constraints |
|--------|------|-------------|
| `agent_id` | uuid | FK to agents, cascade delete, not null |
| `context_doc_id` | uuid | FK to context_docs, cascade delete, not null |
| `order` | integer | Display/injection order, not null, default 0 |

PK: composite `(agent_id, context_doc_id)`.

### New table: `skill_context_docs`

| Column | Type | Constraints |
|--------|------|-------------|
| `skill_id` | uuid | FK to skills, cascade delete, not null |
| `context_doc_id` | uuid | FK to context_docs, cascade delete, not null |
| `order` | integer | Display/injection order, not null, default 0 |

PK: composite `(skill_id, context_doc_id)`.

### Modified contract: `RunTrace.specs_read`

Current: `z.array(z.string())`

New: `z.array(z.object({ path: z.string(), category: z.enum(['specs', 'docs', 'insights', 'other']), tokens: z.number() }))`

This is a breaking change to the shared contract. Existing persisted traces with
the old format will need handling (the read path should accept both shapes during
migration, or a backfill migration should normalize old data).

## UI screens

### Screen 1: Project Context page (design1, design2)

- **Route**: `/repos/[repoId]/project-context`
- **Nav**: Sidebar item "Project Context" under WORKSPACE section
- **Layout**: Two-panel -- file list on left, content preview/edit on right
- **Left panel**:
  - Header: "PROJECT CONTEXT" with subtitle showing the context directory path
    (e.g., `.devdigest/specs/`)
  - Toolbar: "+" (create file), folder icon (create folder), upload icon
    (future, disabled for v1), refresh icon (trigger re-scan)
  - File list: scrollable, each item shows filename with icon. Selected item is
    highlighted. Simple text search input for filtering by filename substring.
  - Footer status: green dot + "Indexed: N files . X chunks" + "last Nm ago"
- **Right panel**:
  - Header: filename + "Preview | Edit" toggle + "Used by N agents" badge +
    coverage indicator
  - Preview mode: rendered markdown
  - Edit mode: plain textarea with "Save" button, unsaved-changes indicator
- **Empty state** (design2): centered message "No spec files yet" with
  description text and "+ Add a spec file" button

### Screen 2: Agent detail -- Context tab (design3)

- **Route**: `/agents/[agentId]` with "Context" tab selected
- **Header**: "Project context" + "2 of 7 attached" count
- **Subtext**: "Order matters -- earlier docs appear earlier in the assembled
  ## Project context block. Toggle to attach."
- **Document list**: each row shows drag handle, filename, path (category
  suffix), category badge (specs/docs/insights), "Preview" button. Attached
  items have a toggle in "on" state.
- **Footer**: combined token count (e.g., "317 tokens") with note "Injected as
  an untrimmed block (## Project context) into every run."

### Screen 3: Skill detail -- Context tab (design4)

- **Route**: `/skills/[skillId]` with "Content" tab
- **Section**: "Project context to use" with "Attached" / "All documents"
  toggle
- **Document list**: similar to agent context tab, checkboxes for
  attach/detach
- **Bottom section**: shows skill's own specifications as a separate group

### Screen 4: Run trace -- Context section (design5)

- **Location**: PR detail page > Agent Runs tab > run trace panel > "Trace" tab
- **Prompt assembly section**: expandable "Project context -- attached specs
  (untrimmed)" item showing:
  - List of individual document paths with token counts
  - Category labels
  - Total token count for the context block

## Context merge algorithm (review time)

```
1. Collect docs from agent_context_docs WHERE agent_id = :agentId
   ORDER BY order ASC
   -> agentDocs[]

2. Collect linked skills from agent_skills WHERE agent_id = :agentId
   AND skill.enabled = true
   ORDER BY agent_skills.order ASC
   -> enabledSkills[]

3. For each skill in enabledSkills (in order):
     Collect docs from skill_context_docs WHERE skill_id = :skillId
     ORDER BY order ASC
     -> append to skillDocs[]

4. Merge: result = agentDocs ++ skillDocs

5. Deduplicate by path (first occurrence wins)

6. For each doc in result:
     Read file content from disk at repos.clone_path + doc.path
     Record { path, category, tokens } in specs_read

7. Concatenate content into the prompt's ## Project context block
```

## Open questions

- [x] **Glob pattern configurability**: Resolved — configurable per-repo in
  settings. Defaults: `**/specs/**/*.md`, `**/docs/**/*.md`, `**/INSIGHTS.md`.
  `insights` is a single file (not a directory).
- [x] **Token counting algorithm**: Resolved — simple word-based heuristic
  (e.g., `content.split(/\s+/).length * 1.3`). No external tokenizer library.
- [x] **Backward compatibility of `specs_read`**: Resolved — no migration
  needed. `specs_read` is always `[]` in production (both write paths in
  `run-executor.ts` hardcode empty arrays). No persisted traces contain
  non-empty string data. Empty arrays parse identically under both the old
  and new schemas. Safe to change the contract directly.
- [x] **Upload button in toolbar**: Resolved — included in v1. Users can
  upload `.md` files from their machine into the repo clone's context
  directories (specs/ or docs/).
- [x] **Coverage indicator**: Resolved — deferred to a future iteration.
  Not included in v1. Only the "Used by N agents" text is shown.
- [x] **Maximum number of context docs per agent/skill**: Resolved — maximum
  10 documents per agent. Skills follow the same limit.
- [x] **Interaction with existing `specs` slot in `PromptAssembly`**: Resolved
  — `PromptAssembly.specs` is the correct injection point. The pipeline is
  already fully wired: `assemblePrompt()` in `reviewer-core/src/prompt.ts`
  wraps each spec with `wrapUntrusted()`, inserts under `## Project context`
  heading, and the UI already renders it in `TraceBody.tsx`. Currently always
  null because `run-executor.ts` never passes `specs` to
  `reviewPullRequest()`. The only change needed is passing resolved context
  docs as `specs: contextSpecs` in the `reviewPullRequest()` call.
