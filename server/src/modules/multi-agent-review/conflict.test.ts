import { describe, it, expect } from 'vitest';
import { computeConflicts, type ConflictFinding } from './conflict.js';

// ---- helpers ----------------------------------------------------------------

function finding(
  overrides: Partial<ConflictFinding> & { agent_id: string; file: string },
): ConflictFinding {
  return {
    agent_name: overrides.agent_id === 'a1' ? 'Agent Alpha' : 'Agent Beta',
    start_line: 10,
    end_line: 15,
    severity: 'WARNING',
    category: 'security',
    title: 'SQL injection risk',
    ...overrides,
  };
}

const ALL_AGENTS = ['a1', 'a2'];

// ---- tests ------------------------------------------------------------------

describe('computeConflicts', () => {
  it('returns empty array when only one agent', () => {
    const findings: ConflictFinding[] = [
      finding({ agent_id: 'a1', file: 'src/foo.ts', start_line: 10, end_line: 20 }),
    ];
    expect(computeConflicts(findings, ['a1'])).toEqual([]);
  });

  it('returns empty array when no findings', () => {
    expect(computeConflicts([], ALL_AGENTS)).toEqual([]);
  });

  it('returns empty array when all agents agree (same severity + category)', () => {
    const findings: ConflictFinding[] = [
      finding({ agent_id: 'a1', file: 'src/foo.ts', start_line: 10, end_line: 15, severity: 'WARNING', category: 'security' }),
      finding({ agent_id: 'a2', file: 'src/foo.ts', start_line: 10, end_line: 15, severity: 'WARNING', category: 'security' }),
    ];
    expect(computeConflicts(findings, ALL_AGENTS)).toEqual([]);
  });

  it('detects conflict when agents assign different severities', () => {
    const findings: ConflictFinding[] = [
      finding({ agent_id: 'a1', file: 'src/foo.ts', start_line: 10, end_line: 15, severity: 'CRITICAL' }),
      finding({ agent_id: 'a2', file: 'src/foo.ts', start_line: 10, end_line: 15, severity: 'WARNING' }),
    ];
    const conflicts = computeConflicts(findings, ALL_AGENTS);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.file).toBe('src/foo.ts');
    expect(conflicts[0]!.line).toBe(10);
    expect(conflicts[0]!.takes).toHaveLength(2);
    const verdicts = conflicts[0]!.takes.map((t) => t.verdict);
    expect(verdicts).toContain('CRITICAL');
    expect(verdicts).toContain('WARNING');
  });

  it('detects conflict when only one agent flagged the region', () => {
    const findings: ConflictFinding[] = [
      finding({ agent_id: 'a1', file: 'src/foo.ts', start_line: 10, end_line: 15 }),
      // a2 did not flag this region
    ];
    const conflicts = computeConflicts(findings, ALL_AGENTS);
    expect(conflicts).toHaveLength(1);
    const takes = conflicts[0]!.takes;
    const a2Take = takes.find((t) => t.agent_id === 'a2');
    expect(a2Take?.verdict).toBe('ignored');
  });

  it('does NOT group non-overlapping findings on the same file', () => {
    const findings: ConflictFinding[] = [
      finding({ agent_id: 'a1', file: 'src/foo.ts', start_line: 1, end_line: 5 }),
      finding({ agent_id: 'a2', file: 'src/foo.ts', start_line: 20, end_line: 25 }),
    ];
    // Each cluster has only one agent → conflicts with 'ignored' takes for the other
    const conflicts = computeConflicts(findings, ALL_AGENTS);
    // Both clusters have one agent missing → both are conflicts
    expect(conflicts).toHaveLength(2);
    for (const c of conflicts) {
      const ignoredTakes = c.takes.filter((t) => t.verdict === 'ignored');
      expect(ignoredTakes).toHaveLength(1);
    }
  });

  it('groups overlapping findings from different agents into one conflict', () => {
    const findings: ConflictFinding[] = [
      finding({ agent_id: 'a1', file: 'src/bar.ts', start_line: 5, end_line: 15, severity: 'CRITICAL' }),
      finding({ agent_id: 'a2', file: 'src/bar.ts', start_line: 10, end_line: 20, severity: 'WARNING' }),
    ];
    const conflicts = computeConflicts(findings, ALL_AGENTS);
    expect(conflicts).toHaveLength(1);
    const verdicts = conflicts[0]!.takes.map((t) => t.verdict);
    expect(verdicts).toContain('CRITICAL');
    expect(verdicts).toContain('WARNING');
  });

  it('ignores findings on different files', () => {
    const findings: ConflictFinding[] = [
      finding({ agent_id: 'a1', file: 'src/a.ts', start_line: 10, end_line: 15, severity: 'CRITICAL' }),
      finding({ agent_id: 'a2', file: 'src/b.ts', start_line: 10, end_line: 15, severity: 'WARNING' }),
    ];
    // Each file has one agent → each cluster creates a conflict with 'ignored'
    const conflicts = computeConflicts(findings, ALL_AGENTS);
    expect(conflicts).toHaveLength(2);
    const files = conflicts.map((c) => c.file).sort();
    expect(files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns empty array when findings exceed 500 (performance guard)', () => {
    const bigFindings: ConflictFinding[] = Array.from({ length: 501 }, (_, i) =>
      finding({
        agent_id: i % 2 === 0 ? 'a1' : 'a2',
        file: `src/file${i}.ts`,
        start_line: i * 10,
        end_line: i * 10 + 5,
      }),
    );
    expect(computeConflicts(bigFindings, ALL_AGENTS)).toEqual([]);
  });
});
