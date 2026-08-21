import { describe, it, expect } from 'vitest';
import { parseDiffToUnifiedDiff } from './helpers.js';

describe('parseDiffToUnifiedDiff', () => {
  it('returns empty files array for empty diff', () => {
    const result = parseDiffToUnifiedDiff('');
    expect(result.raw).toBe('');
    expect(result.files).toHaveLength(0);
  });

  it('parses a single-file diff correctly', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' context line',
      '+added line',
      ' another context',
      '-removed line',
    ].join('\n');

    const result = parseDiffToUnifiedDiff(diff);
    expect(result.raw).toBe(diff);
    expect(result.files).toHaveLength(1);
    const file = result.files[0]!;
    expect(file.path).toBe('src/foo.ts');
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
    expect(file.hunks).toHaveLength(1);
    const hunk = file.hunks[0]!;
    expect(hunk.newStart).toBe(1);
    // context line (1), added line (2), another context (3) are on new side
    expect(hunk.newLineNumbers).toContain(2); // added line
  });

  it('parses a two-file diff', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,1 +1,2 @@',
      ' context',
      '+new line',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -5,2 +5,1 @@',
      ' context',
      '-removed',
    ].join('\n');

    const result = parseDiffToUnifiedDiff(diff);
    expect(result.files).toHaveLength(2);
    expect(result.files[0]!.path).toBe('a.ts');
    expect(result.files[0]!.additions).toBe(1);
    expect(result.files[1]!.path).toBe('b.ts');
    expect(result.files[1]!.deletions).toBe(1);
  });

  it('extracts new-side line numbers correctly', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -10,3 +10,4 @@',
      ' line 10',
      '+line 11',
      ' line 12',
      '+line 13',
    ].join('\n');

    const result = parseDiffToUnifiedDiff(diff);
    const hunk = result.files[0]!.hunks[0]!;
    expect(hunk.newLineNumbers).toContain(11); // first added line
    expect(hunk.newLineNumbers).toContain(13); // second added line
    expect(hunk.newStart).toBe(10);
  });

  it('preserves the raw diff text', () => {
    const raw = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n+x';
    const result = parseDiffToUnifiedDiff(raw);
    expect(result.raw).toBe(raw);
  });

  it('handles renamed files via +++ b/ path', () => {
    const diff = [
      'diff --git a/old.ts b/new.ts',
      '--- a/old.ts',
      '+++ b/new.ts',
      '@@ -1,1 +1,1 @@',
      ' no change',
    ].join('\n');

    const result = parseDiffToUnifiedDiff(diff);
    expect(result.files[0]!.path).toBe('new.ts');
  });
});
