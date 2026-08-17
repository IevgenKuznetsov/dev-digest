import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

// ======================================================= Project Context

export const contextDocs = pgTable(
  'context_docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    category: text('category', { enum: ['specs', 'docs', 'insights', 'other'] }).notNull(),
    tokens: integer('tokens').notNull(),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    repoPathUq: uniqueIndex('context_docs_repo_path_uq').on(t.repoId, t.path),
    repoIdx: index('context_docs_repo_idx').on(t.repoId),
  }),
);

export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    contextDocId: uuid('context_doc_id')
      .notNull()
      .references(() => contextDocs.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.contextDocId] }) }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    contextDocId: uuid('context_doc_id')
      .notNull()
      .references(() => contextDocs.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.contextDocId] }) }),
);
