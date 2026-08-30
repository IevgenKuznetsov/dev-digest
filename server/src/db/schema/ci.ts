import { pgTable, uuid, text, integer, timestamp, doublePrecision } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable('ci_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
  /** Agent version at install time; used by the CI tab to show which version is deployed. */
  agentVersion: integer('agent_version'),
});

export const ciRuns = pgTable('ci_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
    onDelete: 'set null',
  }),
  prNumber: integer('pr_number'),
  ranAt: timestamp('ran_at', { withTimezone: true }),
  status: text('status'),
  findingsCount: integer('findings_count'),
  costUsd: doublePrecision('cost_usd'),
  githubUrl: text('github_url'),
  source: text('source'),
  /** Commit SHA of the PR head that was reviewed (from ingest artifact). */
  commitSha: text('commit_sha'),
  /** Model used for this run (from ingest artifact). */
  model: text('model'),
  /** Manifest version (AgentManifest.version) at the time of the run. */
  manifestVersion: text('manifest_version'),
});
