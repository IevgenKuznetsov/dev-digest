import type { Container } from '../../platform/container.js';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';

/**
 * F1 — workspace service. Workspace summary: clone dir + cloned repos overview.
 */
export class WorkspaceService {
  constructor(private container: Container) {}

  async summary(workspaceId: string) {
    const repos = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId));
    return {
      workspaceId,
      cloneDir: this.container.config.cloneDir,
      repos: repos.map((r) => ({
        id: r.id,
        full_name: r.fullName,
        clone_path: r.clonePath,
        last_polled_at: r.lastPolledAt?.toISOString() ?? null,
        cloned: Boolean(r.clonePath),
      })),
    };
  }
}
