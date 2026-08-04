# Skills CRUD

## Data Model

A **Skill** is a reusable block of instructions (markdown body) injected into an
agent's review prompt. Skills are workspace-scoped and versioned.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK, auto-generated |
| `workspace_id` | uuid | FK → workspaces, cascade delete |
| `name` | text | required, non-empty |
| `description` | text | required; phrased directively (interface of the skill) |
| `type` | enum | `rubric` \| `convention` \| `security` \| `custom` |
| `source` | enum | `manual` \| `imported_url` \| `extracted` \| `community` |
| `body` | text | markdown content — the actual rules/instructions |
| `enabled` | boolean | global kill-switch; default `true` |
| `version` | integer | starts at 1, bumps on body change |
| `evidence_files` | jsonb | optional string array |

### Versioning

Every body change bumps `version` and snapshots the new body into `skill_versions`
(immutable append-only table, PK: `skill_id + version`).

## API Surface

All routes are workspace-scoped via `getContext()`.

### `GET /skills` — List all skills

Returns `Skill[]` ordered by `created_at` descending.

### `GET /skills/:id` — Get one skill

Returns `Skill`. 404 if not found or wrong workspace.

### `POST /skills` — Create a skill

Body: `{ name, description, type, source?, body, enabled? }`

- `source` defaults to `"manual"`.
- Inserts skill row + version 1 snapshot.
- Returns the created `Skill`.

### `PUT /skills/:id` — Update a skill

Body: `{ name?, description?, type?, body?, enabled? }`

- If `body` changed: bump `version`, insert new `skill_versions` row.
- If only non-body fields changed: no version bump.
- Returns the updated `Skill`. 404 if not found.

### `DELETE /skills/:id` — Delete a skill

Cascades to `skill_versions` and `agent_skills` links. Returns `204`.

### `POST /skills/import/preview` — Preview an import

Body: `{ body: string, name?: string }`

- Parses the markdown body to extract a name (from first `# heading` if `name` not provided)
  and description (from first paragraph).
- Returns `{ name, description, body, type: "custom" }` — a preview DTO, not persisted.

### `POST /skills/import/confirm` — Confirm an import

Body: `{ name, description, type, body, source? }`

- `source` defaults to `"imported_url"`.
- Identical to `POST /skills` but with a different default source.
- Returns the created `Skill`.

## Engine Integration

When `ReviewRunExecutor.runOneAgent()` runs a review:

1. Load the agent's linked skills via `AgentsRepository.linkedSkills(agentId)`.
2. Filter to `skill.enabled === true`.
3. Map to `skill.body` strings (preserving `order` from `agent_skills`).
4. Pass as `skills: string[]` to `reviewPullRequest()`.

The prompt assembler (`reviewer-core/src/prompt.ts`) renders them as:

```
## Skills / rules
<skill 1 body>

<skill 2 body>
```

Disabled skills (globally or unlinked from the agent) are never passed to the engine.

## Agent Skill Binding

Managed by the existing `agents` module routes:

- `GET /agents/:id/skills` — linked skills in order
- `POST /agents/:id/skills` — `{ skill_ids: string[] }` replaces the full set with order = index;
  OR `{ skill_id, order? }` links a single skill.

The `agent_skills` junction table carries `order` (0-based). Order determines
position in the assembled prompt: lower order = earlier in the prompt.
