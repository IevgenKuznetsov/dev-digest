# Skills UI

## Skills Page (`/skills`)

### Layout

Two-panel layout: skill list (left) + preview/editor panel (right).

### Skill List (Left Panel)

- Header: "Skills" heading + "Add Skill" dropdown button
- Search input: filters cards by name (case-insensitive substring match)
- Grid of `SkillCard` components

#### SkillCard

| Element | Content |
|---------|---------|
| Name | `skill.name` |
| Type badge | Color-coded: `rubric` (green), `convention` (blue), `security` (orange), `custom` (gray) |
| Description | Truncated `skill.description` |
| Enabled toggle | Calls `PUT /skills/:id` with `{ enabled }` |
| Source badge | Only shown for imported/community skills |

- Click card → select it, show in right panel
- Selected card has highlighted border

#### "Add Skill" Dropdown

- "Import from file" → opens import drawer
- "Import from URL" → opens import drawer on URL tab

### Preview/Editor Panel (Right Panel)

When no skill selected: placeholder "Select a skill on the left to preview its body."

When skill selected:
- Name (editable `TextInput`)
- Description (editable `Textarea`, hint: "Phrased directively — this is the skill's interface")
- Type (editable `SelectInput`)
- Body (editable `Textarea`, markdown, hint: "Saving a changed body creates a new immutable version")
- Version badge: `v{version}`
- Save button (disabled when no changes or while saving)

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