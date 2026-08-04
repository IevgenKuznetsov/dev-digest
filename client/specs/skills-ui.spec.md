# Skills UI

## Skills Page (`/skills`)

### Layout

Two-panel layout: skill list (left) + preview/editor panel (right).

Full-height two-panel layout matching the agent editor pattern
(`display: flex, height: calc(100vh - 52px)`).

### Skill List (Left Sidebar, 320px)

- Header: "Skills" heading + "Add Skill" dropdown button
- Search input: filters cards by name (case-insensitive substring match)
- Scrollable list of `SkillCard` components

#### SkillCard

| Element | Content |
|---------|---------|
| Status dot | Green (enabled) or red (disabled) |
| Name | `skill.name` |
| Description | Truncated `skill.description` |
| Type badge | Color-coded: `rubric` (green), `convention` (blue), `security` (orange), `custom` (gray) |
| Source badge | Only shown for imported/community skills |

- Click card → select it, show in right panel, reset to Config tab
- Selected card has accent border + surface background

#### "Add Skill" Dropdown

- "Import from file" → opens import drawer

### Detail Panel (Right)

When no skill selected: centered placeholder "Select a skill / Pick a skill on the left to preview its body."

When skill selected:
- **Header bar**: skill name (h1), type badge, version badge (`v{version}`)
- **Tab bar**: Config | Preview | Evals | Stats | Versions

#### Config Tab

- "Configuration" heading + enabled toggle (right-aligned, with Enabled/Disabled label)
- Name input (required)
- Description input
- Type dropdown
- "Skill body *" section: filename badge (`{name}.md`), monospace textarea, hint about version creation
- Save / Delete buttons (save disabled when no changes or while saving)

#### Preview Tab

- "Preview" heading + subtitle "Rendered as the reviewing agent receives it."
- Skill body rendered as formatted markdown via `<Markdown>` component in a bordered panel

#### Evals Tab

- "Eval cases" heading with count badge + "Run all" and "New eval case" buttons (disabled — eval module pending)
- Lists eval cases from `GET /skills/:id/eval-cases` (`owner_kind = 'skill'`)
- Each case: icon, name, notes
- Empty state when no cases exist

#### Stats Tab

- Stat card: "USED BY" with agents count
- "AGENTS USING THIS SKILL" list from `GET /skills/:id/stats`
- Each agent: name
- Empty message guiding user to link from agent's Skills tab

#### Versions Tab

- "Version history" heading with count badge
- Subtitle explaining snapshot purpose (eval reproducibility)
- Version list from `GET /skills/:id/versions` (descending)
- Each version: version number (`v{N}`), date, "Current" badge for active version
- Non-current versions have "Restore" button → `POST /skills/:id/versions/:ver/restore` (with confirmation dialog)

### Import Drawer

Modal/drawer with tabs: "From file" | "From URL"

#### From File Tab

- Name field (optional — derived from first `# heading` if blank)
- Body textarea (paste markdown or upload `.md` file)
- Trust callout (yellow banner): "External skills inject instructions into your agent's prompt"
- "Import skill" button → calls `POST /skills/import/confirm`
- On success: toast, close drawer, invalidate skills list

#### From URL Tab

- URL input field
- "Import from URL" button → calls the import endpoint
- Trust + vetting callout: imported as disabled until vetted

---

## Agent Editor — Skills Tab

### Access

Tab "Skills" in the agent editor (`/agents/:id?tab=skills`), between Config and Evals.

### Layout

- Header line: "Skills" + badge "`{linked} of {total} enabled`" + filter input
- Hint text: "Order matters — earlier skills appear earlier in the assembled prompt. Toggle to attach."
- Skill rows list

### Skill Row

| Element | Behavior |
|---------|----------|
| Drag handle (≡) | HTML5 drag-to-reorder; reorder updates `skill_ids` array |
| Checkbox | Checked = linked to this agent; toggle adds/removes from set |
| Skill name | Plain text |
| Type badge | Same color scheme as Skills page |

### Data Flow

- All workspace skills: `GET /skills` → `useSkills()`
- Agent's linked skills: `GET /agents/:id/skills` → `useAgentSkills(agentId)`
- On any change (toggle or reorder): `POST /agents/:id/skills` with full ordered `{ skill_ids }` → `useSetAgentSkills()`

### Ordering Rules

- Linked skills appear at the top in their current order
- Unlinked skills appear below, sorted alphabetically
- Drag-to-reorder only applies to linked skills
- New skill linked via checkbox gets appended at the end (highest order)

---

## Navigation

Sidebar restructured with "SKILLS LAB" section:

| Section | Items |
|---------|-------|
| WORKSPACE | Pull Requests |
| SKILLS LAB | Skills, Agents |

Keyboard shortcut: `g s` → Go to Skills page.