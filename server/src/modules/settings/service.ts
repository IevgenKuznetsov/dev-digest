import type { Container } from '../../platform/container.js';
import type { Settings, ConnTestResult, ConnTestProvider, SecretsStatus } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';
import { rowsToSettings } from './helpers.js';

/**
 * F1 — settings service. Business logic for non-secret prefs + connection tests.
 * No HTTP lives here — persistence goes through Drizzle, secrets through
 * SecretsProvider, provider tests through the Container's adapters.
 */
export class SettingsService {
  constructor(private container: Container) {}

  async get(workspaceId: string): Promise<Settings> {
    const rows = await this.container.db
      .select()
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
    return rowsToSettings(rows);
  }

  async update(
    workspaceId: string,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<Settings> {
    for (const [key, value] of Object.entries(body)) {
      await this.container.db
        .insert(t.settings)
        .values({ workspaceId, userId, key, value })
        .onConflictDoUpdate({
          target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
          set: { value },
        });
    }
    return this.get(workspaceId);
  }

  async secretsStatus(): Promise<SecretsStatus> {
    const entries = await Promise.all(
      (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
        async ([provider, key]) => [provider, Boolean(await this.container.secrets.get(key))] as const,
      ),
    );
    return Object.fromEntries(entries) as SecretsStatus;
  }

  async testConnection(provider: ConnTestProvider, key?: string): Promise<ConnTestResult> {
    try {
      if (key) {
        if (!this.container.secrets.set) {
          return { provider, ok: false, message: 'Secrets backend is read-only' };
        }
        await this.container.secrets.set(SECRET_KEY_BY_PROVIDER[provider], key);
        this.container.invalidateSecretCaches();
      }
      if (provider === GITHUB_PROVIDER) {
        const gh = await this.container.github();
        const login = await gh.currentLogin();
        return { provider, ok: true, message: `Connected as @${login}` };
      }
      const llm = await this.container.llm(provider);
      const models = await llm.listModels();
      return { provider, ok: true, message: `OK — ${models.length} models available` };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  }
}
