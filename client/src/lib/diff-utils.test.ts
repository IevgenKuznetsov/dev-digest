import { describe, it, expect } from 'vitest';
import { extractRelevantHunks } from './diff-utils';

// Helpers to build minimal unified diff patches
function makeHeader(file = 'src/foo.ts'): string {
  return `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}`;
}

function makeHunk(newStart: number, newLines: number, bodyLines: string[] = []): string {
  const body = bodyLines.join('\n');
  const hunkHeader = `@@ -${newStart},${newLines} +${newStart},${newLines} @@`;
  return body ? `${hunkHeader}\n${body}` : hunkHeader;
}

function makePatch(hunks: string[], file = 'src/foo.ts'): string {
  return `${makeHeader(file)}\n${hunks.join('\n')}`;
}

describe('extractRelevantHunks', () => {
  it('returns the hunk when a single-hunk patch overlaps the finding range', () => {
    const hunk = makeHunk(10, 5, [' line 10', '+line 11', ' line 12']);
    const patch = makePatch([hunk]);

    const result = extractRelevantHunks(patch, 11, 12);

    expect(result).toContain('@@ -10,5 +10,5 @@');
    expect(result).toContain('diff --git');
    expect(result).toContain('--- a/src/foo.ts');
  });

  it('returns only the overlapping hunk when multiple hunks exist and finding overlaps one', () => {
    const hunk1 = makeHunk(1, 3, [' a', ' b', ' c']);
    const hunk2 = makeHunk(50, 3, [' x', ' y', ' z']);
    const patch = makePatch([hunk1, hunk2]);

    const result = extractRelevantHunks(patch, 50, 52);

    expect(result).toContain('@@ -50,3 +50,3 @@');
    expect(result).not.toContain('@@ -1,3 +1,3 @@');
  });

  it('returns both hunks when the finding spans two hunks', () => {
    const hunk1 = makeHunk(10, 5, [' line10', ' line11', ' line12', ' line13', ' line14']);
    const hunk2 = makeHunk(20, 5, [' line20', ' line21', ' line22', ' line23', ' line24']);
    const patch = makePatch([hunk1, hunk2]);

    // finding range [14, 20] overlaps both hunks
    const result = extractRelevantHunks(patch, 14, 20);

    expect(result).toContain('@@ -10,5 +10,5 @@');
    expect(result).toContain('@@ -20,5 +20,5 @@');
  });

  it('falls back to the full patch when no hunk overlaps the finding range', () => {
    const hunk1 = makeHunk(1, 3, [' a', ' b', ' c']);
    const hunk2 = makeHunk(50, 3, [' x', ' y', ' z']);
    const patch = makePatch([hunk1, hunk2]);

    // finding range [100, 110] doesn't overlap any hunk
    const result = extractRelevantHunks(patch, 100, 110);

    expect(result).toBe(patch);
  });

  it('preserves diff --git, ---, +++ header lines', () => {
    const hunk = makeHunk(5, 2, [' line5', ' line6']);
    const patch = makePatch([hunk]);

    const result = extractRelevantHunks(patch, 5, 6);

    expect(result).toContain('diff --git a/src/foo.ts b/src/foo.ts');
    expect(result).toContain('--- a/src/foo.ts');
    expect(result).toContain('+++ b/src/foo.ts');
  });

  it('returns the full patch when patch contains no hunk headers', () => {
    const patch = 'diff --git a/foo.ts b/foo.ts\n--- a/foo.ts\n+++ b/foo.ts\nno hunks here';

    const result = extractRelevantHunks(patch, 1, 10);

    expect(result).toBe(patch);
  });

  it('handles a hunk without explicit line count (defaults newLines to 1)', () => {
    // @@ -5 +5 @@ — no comma, implies 1 line; finding at line 5 overlaps it
    // A patch with a second hunk far away lets us verify only hunk1 is returned
    const hunkAt5 = '@@ -5 +5 @@\n line5';
    const hunkAt100 = '@@ -100,3 +100,3 @@\n lineA\n lineB\n lineC';
    const patch = `${makeHeader()}\n${hunkAt5}\n${hunkAt100}`;

    // finding exactly at line 5 — should include hunk at 5 but not at 100
    const result = extractRelevantHunks(patch, 5, 5);

    expect(result).toContain('@@ -5 +5 @@');
    expect(result).not.toContain('@@ -100,3 +100,3 @@');
  });
});
