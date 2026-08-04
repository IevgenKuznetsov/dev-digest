import { describe, it, expect } from 'vitest';
import { parseMarkdownSkill, toSkillDto } from '../src/modules/skills/helpers.js';

describe('parseMarkdownSkill', () => {
  it('extracts name from first heading', () => {
    const md = '# My Rubric\nThis is the description.\n\nBody content.';
    const result = parseMarkdownSkill(md);
    expect(result.name).toBe('My Rubric');
    expect(result.description).toBe('This is the description.');
    expect(result.body).toBe(md);
    expect(result.type).toBe('custom');
  });

  it('uses nameOverride when provided', () => {
    const md = '# Heading\nDescription.';
    const result = parseMarkdownSkill(md, 'Override Name');
    expect(result.name).toBe('Override Name');
  });

  it('defaults name to "Untitled skill" when no heading', () => {
    const md = 'No heading here.\nJust text.';
    const result = parseMarkdownSkill(md);
    expect(result.name).toBe('Untitled skill');
  });

  it('handles empty markdown', () => {
    const result = parseMarkdownSkill('');
    expect(result.name).toBe('Untitled skill');
    expect(result.description).toBe('');
    expect(result.body).toBe('');
  });

  it('skips sub-headings for description', () => {
    const md = '# Title\n## Sub-heading\nActual description.';
    const result = parseMarkdownSkill(md);
    expect(result.name).toBe('Title');
    expect(result.description).toBe('Actual description.');
  });
});

describe('toSkillDto', () => {
  it('maps row fields to DTO with correct types', () => {
    const row = {
      id: 'abc-123',
      workspaceId: 'ws-1',
      name: 'Test Skill',
      description: 'A test skill',
      type: 'rubric' as const,
      source: 'manual' as const,
      body: '# Rules\nDo this.',
      enabled: true,
      version: 2,
      evidenceFiles: ['a.ts', 'b.ts'],
      createdAt: new Date(),
    };
    const dto = toSkillDto(row);
    expect(dto).toEqual({
      id: 'abc-123',
      name: 'Test Skill',
      description: 'A test skill',
      type: 'rubric',
      source: 'manual',
      body: '# Rules\nDo this.',
      enabled: true,
      version: 2,
      evidence_files: ['a.ts', 'b.ts'],
    });
  });

  it('maps null evidenceFiles to null', () => {
    const row = {
      id: 'abc-123',
      workspaceId: 'ws-1',
      name: 'Test',
      description: '',
      type: 'custom' as const,
      source: 'manual' as const,
      body: 'body',
      enabled: false,
      version: 1,
      evidenceFiles: null,
      createdAt: new Date(),
    };
    const dto = toSkillDto(row);
    expect(dto.evidence_files).toBeNull();
  });
});
