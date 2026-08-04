---
name: semver-discipline
description: "Flags when a change requires a major, minor, or patch version bump. TRIGGER: when a diff introduces a breaking API change, adds a new feature/endpoint, drops a DB column, changes Node engine requirements, removes an export from @devdigest/shared, or bumps a peer dependency. Cross-references breaking-change and response-schema skills for severity classification."
metadata:
  author: ievgen.kuznetsov@gmail.com
  version: 0.1.0
---

# Semver Discipline

Every change to a public API surface must be accompanied by the correct version bump and a CHANGELOG entry. This skill ties together `breaking-change` and `response-schema` findings with versioning requirements.

## When to Use

- Any change that `breaking-change` or `response-schema` skills would flag
- Changes to `package.json` fields (`version`, `engines`, `peerDependencies`)
- Drizzle migration files that drop, rename, or alter column types
- Docker image tag or base image changes
- New endpoints, features, or exports added

## Rules

1. **Breaking API change → MAJOR** — any change flagged as CRITICAL by `breaking-change` or `response-schema` requires a major version increment. Removed endpoints, renamed fields, dropped columns, removed exports — all MAJOR.

2. **Irreversible DB migration → MAJOR** — migrations that drop columns, rename tables, change column types, or remove constraints without a reversible path. The project uses `pnpm db:generate` and `pnpm db:migrate`; once applied, these cannot be undone without data loss.

3. **New feature or endpoint → MINOR** — new route handlers, new Zod contracts, new Drizzle tables, new exports from `@devdigest/shared`. Additive, backward-compatible changes.

4. **Bug fix → PATCH** — fixes that don't change the API surface. Correcting a wrong status code to match documentation is a PATCH if documented, MAJOR if undocumented (consumers may depend on the current behavior).

5. **Docker image tag change → MAJOR when destructive** — changing the base image tag (e.g., `pgvector/pgvector:pg16` → `pg17`) is MAJOR if it requires data migration or changes wire-level behavior. Tag updates for security patches are PATCH.

6. **Node.js engine requirement change → MAJOR** — bumping `engines.node` in `package.json` (e.g., `>=20` → `>=22`) excludes users on older Node versions. This is a breaking environmental change.

7. **Dropped export from `@devdigest/shared` → MAJOR** — removing any export from the barrel violates the project convention ("extend with new files only, never edit existing contracts") and requires a major bump.

8. **Changed default behavior → context-dependent** — changing a rate limit default, toggling a default `enabled` flag, or altering seed data shape. If the default is user-facing or affects API behavior: MINOR at minimum, MAJOR if it breaks existing workflows.

9. **Peer dependency major bump → coordinated MAJOR** — upgrading a peer dependency (Fastify 5→6, Drizzle major bump, React major bump) flows through to consumers and requires a coordinated major version increment across affected packages.

10. **CHANGELOG entry required** — every version bump must have a corresponding CHANGELOG entry. The entry must describe what changed, why, and any migration steps needed.

## Examples

### Bad — breaking migration without version bump

```typescript
// server/src/db/migrations/0042_drop_verdict.sql
// ❌ Column dropped, no MAJOR version bump in package.json
ALTER TABLE reviews DROP COLUMN verdict;
```

### Good — MAJOR bump with migration guide

```json
// package.json
{ "version": "3.0.0" }
```
```markdown
// CHANGELOG.md
## 3.0.0 — Breaking Changes
- Removed `verdict` column from `reviews` table
- **Migration:** Run `pnpm db:migrate`. Update queries to use `outcome` column.
  See deprecation notice in v2.3.0.
```

### Bad — new engine requirement without version bump

```json
// ❌ Bumped Node requirement but version stayed at 2.5.1
{
  "version": "2.5.1",
  "engines": { "node": ">=22" }
}
```

### Good — MAJOR bump for engine change

```json
{
  "version": "3.0.0",
  "engines": { "node": ">=22" }
}
```

### Bad — new feature without MINOR bump

```typescript
// ❌ New endpoint added, version still 2.1.0
app.post('/skills/import/url/confirm', handler); // brand new feature
```

### Good — MINOR bump for new feature

```json
{ "version": "2.2.0" }
```
```markdown
// CHANGELOG.md
## 2.2.0
- Added URL import for skills (`POST /skills/import/url/confirm`)
```

## Version Bump Decision Tree

```
Is it a breaking change (CRITICAL from breaking-change or response-schema)?
  └─ Yes → MAJOR
  └─ No → Is it a new feature, endpoint, or export?
           └─ Yes → MINOR
           └─ No → Is it a bug fix or internal refactor?
                    └─ Yes → PATCH
                    └─ No → No version bump needed
```

## Severity Mapping

| Severity | Criteria |
|----------|----------|
| **CRITICAL** | Breaking change without MAJOR bump, dropped export without version increment |
| **WARNING** | New feature without MINOR bump, missing CHANGELOG entry for any version bump |
| **SUGGESTION** | Patch-level change without version bump (acceptable in pre-1.0), internal refactor without PATCH |

## Exceptions

1. **Pre-1.0 projects** — semver spec allows breaking changes in MINOR versions before 1.0. Document this explicitly if the project follows this convention.
2. **Internal tools and scripts** — `scripts/`, internal CLI tools not consumed by external packages.
3. **Dev dependencies** — upgrading vitest, eslint, prettier, etc. does not require a version bump.
4. **Documentation-only changes** — `*.md` files, comments, JSDoc updates without code changes.
5. **CI/CD configuration** — GitHub Actions workflows, Dockerfile changes that don't affect the runtime API.
