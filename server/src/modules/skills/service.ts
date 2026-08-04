import type { Container } from '../../platform/container.js';
import type { Skill, SkillType, SkillSource } from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import { toSkillDto, parseMarkdownSkill, type ImportPreview } from './helpers.js';

/**
 * A1 — skills service. Business logic for Skills CRUD and import.
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source ?? 'manual',
      body: input.body,
      enabled: input.enabled,
    });
    return toSkillDto(row);
  }

  async update(workspaceId: string, id: string, patch: UpdateSkillInput): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async listVersions(skillId: string) {
    return this.repo.listVersions(skillId);
  }

  async getVersion(skillId: string, version: number) {
    return this.repo.getVersion(skillId, version);
  }

  /** Restore a skill's body from a previous version. */
  async restoreVersion(workspaceId: string, skillId: string, version: number): Promise<Skill | undefined> {
    const ver = await this.repo.getVersion(skillId, version);
    if (!ver) return undefined;
    return this.update(workspaceId, skillId, { body: ver.body });
  }

  /** Parse a markdown body for import preview — no persistence. */
  importPreview(body: string, name?: string): ImportPreview {
    return parseMarkdownSkill(body, name);
  }

  /** Persist a previewed import as a new skill. */
  async importConfirm(
    workspaceId: string,
    input: CreateSkillInput,
  ): Promise<Skill> {
    return this.create(workspaceId, {
      ...input,
      source: input.source ?? 'imported_url',
    });
  }
}
