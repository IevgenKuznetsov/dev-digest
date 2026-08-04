# Conventions UI

## Navigation

### Sidebar

Add a "Conventions" entry to the SKILLS LAB section in `vendor/ui/nav.ts`:

```typescript
{ key: "conventions", label: "Conventions", icon: "ListChecks", href: "/repos/:repoId/conventions", gKey: "c" }
```

Placed after Agents in the SKILLS LAB group. Icon: `ListChecks` (matches the
design mockup's list-with-checkmarks icon).

### Keyboard Shortcut

Add to `SHORTCUTS` in `nav.ts`:

```typescript
{ keys: "g c", label: "Go to Conventions", group: "Navigation" }
```

### Active Key

Already handled — `activeKeyFor()` in `app-shell/helpers.ts:31` maps
`/conventions` paths to the `"conventions"` key.

### Breadcrumbs

```
Skills Lab > Conventions
```

Pattern: same as agents (`{ label: "Skills Lab" }, { label: "Conventions" }`).

## Route

`/repos/[repoId]/conventions/page.tsx` — thin page that imports
`ConventionsView` from `_components/ConventionsView/`.

The page resolves `repoId` from URL params and passes it to the view component.

## Conventions Page

### Layout

Single-panel full-height layout (`height: calc(100vh - 52px)`, matching
existing pages). No left/right split — conventions are displayed as a vertical
list.

### Header

| Element | Content |
|---------|---------|
| Heading | `Conventions in {repo.full_name}` (repo name in accent color) |
| Subtitle | `Detected from {N} sample files · last scan {relative time}` (shown after extraction) |
| Actions (right) | "Re-scan" button (secondary, RefreshCw icon) |

### States

#### Empty State (no conventions extracted yet) — design3.png

Centered `EmptyState` component (from `@devdigest/ui`):
- Icon: `ListChecks`
- Title: "No conventions extracted yet"
- Description: "Scan the repo to surface house-rules — naming, error handling,
  structure — each backed by evidence you can turn into a Skill."
- Action button: "+ Run extraction" (primary)

#### Loading State

While extraction is running:
- Button shows spinner + "Extracting..."
- Disable "Re-scan" button

#### Populated State — design1.png

Top bar (below header):
- Left: "Deselect all" link (with X icon) + `{accepted} of {total} accepted` count
- Right: "Create skill" button (primary, green, Sparkles icon).
  Disabled when 0 conventions are accepted.

Below: vertical list of `ConventionCard` components.

### ConventionCard

Each convention rendered as a card with these elements:

| Element | Content | Position |
|---------|---------|----------|
| Rule title | Bold text, e.g. "Always use async/await instead of .then() chains" | Top-left |
| Category badge | Parsed from `[Category]` prefix in rule, e.g. "Error Handling" | Inline after title (or above) |
| Evidence path | `src/api/users.ts:23-31` (monospace, muted color) | Below title |
| Code snippet | Syntax-highlighted code block (1-5 lines) | Below path |
| Confidence bar | Colored progress bar + percentage label | Bottom-left |
| Accept button | Green "Accepted" or gray "Accept" toggle | Right side |
| Reject button | "Reject" text button | Right side, below Accept |

#### Accept/Reject Behavior

- Click "Accept" → `PATCH /conventions/:id` with `{ accepted: true }` →
  button becomes green "Accepted" (checkmark icon)
- Click "Accepted" (toggle off) → `PATCH /conventions/:id` with
  `{ accepted: false }` → reverts to gray "Accept"
- Click "Reject" → same as toggling accepted to false
- "Deselect all" → `PATCH /conventions/batch` with all convention ids +
  `{ accepted: false }`

#### Confidence Bar Colors

| Range | Color |
|-------|-------|
| 0.0–0.4 | Red |
| 0.4–0.7 | Yellow/Orange |
| 0.7–1.0 | Green |

Display as percentage: `85%` for confidence 0.85.

### Re-scan

"Re-scan" button (top-right):
- Calls `POST /repos/:id/conventions/extract`
- Replaces all existing conventions with fresh results
- Resets all accepted states (new extraction = all unaccepted)
- Shows loading state during extraction

## Create Skill Modal — design2.png

Triggered by "Create skill" button. Uses `Modal` from `@devdigest/ui`.

### Modal Layout

| Element | Content |
|---------|---------|
| Title | "Create skill from conventions" |
| Subtitle | `{repo.name}-conventions` |
| Info banner | Blue info box: "Merged from **{N} accepted conventions** in **{repo.name}**. Everything below is editable before you save." |

### Form Fields

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| Name | TextInput | `{repo.name}-conventions` | Required, min 1 char |
| Description | TextInput | `{N} house conventions extracted from {repo.name}` | Required |
| Type | SelectInput | `convention` | Dropdown with SkillType values; pre-selected |
| Enabled | Toggle | `true` | "Whether this block is added to agents' prompts." |
| Skill body | Textarea (monospace) | Generated markdown | Read-only preview with filename badge (`{name}.md`), token count |

### Skill Body Preview

The body is generated client-side from accepted conventions using the same
`buildSkillBody` logic as the server (or fetched via the create-skill endpoint).
Displayed as a monospace code block in the modal, showing the markdown that will
become the skill body.

Format (matching design2.png):

```markdown
# {repo-name}-conventions

House conventions for '{repo-name}'. Flag changes that violate any rule below
and cite the offending 'file:line'.

## {Category}
- {rule text}
  Detected in '{evidence_path}':
  ```
  {snippet}
  ```
```

### Footer Actions

| Button | Behavior |
|--------|----------|
| Cancel | Close modal, no action |
| Create skill | `POST /repos/:id/conventions/skill` with `{ name, description }` → creates skill → toast success "Saved as v1 · added to Skills Lab" → close modal → invalidate skills query |

## API Hooks

New hooks in `client/src/lib/hooks/conventions.ts`:

```typescript
useConventions(repoId)          // GET /repos/:id/conventions → ConventionCandidate[]
useExtractConventions()         // POST /repos/:id/conventions/extract (mutation)
useUpdateConvention()           // PATCH /conventions/:id (mutation)
useBatchUpdateConventions()     // PATCH /conventions/batch (mutation)
useDeleteConventions()          // DELETE /repos/:id/conventions (mutation)
useCreateConventionSkill()      // POST /repos/:id/conventions/skill (mutation)
```

All mutations invalidate the `['conventions', repoId]` query key on success.
`useCreateConventionSkill` also invalidates `['skills']`.

## File Structure

```
client/src/
  app/repos/[repoId]/conventions/
    page.tsx                           — thin page entry
    _components/
      ConventionsView/
        ConventionsView.tsx            — main view component
        styles.ts                      — CSSProperties styles
        index.ts                       — barrel export
      ConventionCard/
        ConventionCard.tsx             — single convention card
        styles.ts
        index.ts
      CreateSkillModal/
        CreateSkillModal.tsx           — modal for skill creation
        styles.ts
        index.ts
  lib/hooks/
    conventions.ts                     — TanStack Query hooks
```

## Data Flow

1. Page loads → `useConventions(repoId)` fetches conventions
2. Empty → show EmptyState with "Run extraction" button
3. User clicks "Run extraction" → `useExtractConventions().mutate(repoId)` →
   loading state → conventions appear
4. User clicks Accept/Reject → `useUpdateConvention().mutate({ id, accepted })` →
   optimistic update on the card
5. User clicks "Deselect all" → `useBatchUpdateConventions().mutate({ ids, accepted: false })`
6. User clicks "Create skill" → open `CreateSkillModal` →
   pre-fill fields → user edits name/description → submit →
   `useCreateConventionSkill().mutate({ repoId, name, description })` →
   toast + close + navigate to skills page (optional)
7. User clicks "Re-scan" → same as step 3 (replaces existing)

## Testing

Component tests (Vitest + Testing Library, jsdom):

- `ConventionsView.test.tsx`:
  - Renders empty state when no conventions
  - Renders convention cards when data present
  - "Run extraction" button triggers mutation
  - "Deselect all" triggers batch update

- `ConventionCard.test.tsx`:
  - Renders rule, evidence, confidence
  - Accept button toggles state
  - Reject button sets accepted to false

- `CreateSkillModal.test.tsx`:
  - Pre-fills name and description from repo name + count
  - Submit calls create mutation with form values
  - Cancel closes modal
