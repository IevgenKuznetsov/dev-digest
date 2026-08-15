import { describe, it, expect } from 'vitest';
import { countTokens, categorizeFile, validateFilename, validateContent } from './scanner.js';
import { MAX_FILE_SIZE } from './helpers.js';

// ====================================================== countTokens

describe('countTokens', () => {
  it('counts words and applies the 1.3 multiplier', () => {
    // "hello world foo" = 3 words * 1.3 = 3 (truncated)
    expect(countTokens('hello world foo')).toBe(3);
  });

  it('counts a realistic markdown snippet accurately', () => {
    const content = 'All public endpoints MUST rate-limit requests.\nFailure to comply is a CRITICAL finding.';
    // words: "All", "public", "endpoints", "MUST", "rate-limit", "requests.", "Failure", "to", "comply", "is", "a", "CRITICAL", "finding." = 13 words
    const expected = Math.trunc(13 * 1.3); // 16
    expect(countTokens(content)).toBe(expected);
  });

  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('handles strings with leading/trailing/multiple whitespace', () => {
    const withSpaces = '  hello   world  ';
    // filter removes empty strings from split, so 2 words → Math.trunc(2 * 1.3) = 2
    expect(countTokens(withSpaces)).toBe(2);
  });
});

// ====================================================== categorizeFile

describe('categorizeFile', () => {
  it('returns "insights" when filename is INSIGHTS.md (any depth)', () => {
    expect(categorizeFile('INSIGHTS.md', '**/INSIGHTS.md')).toBe('insights');
    expect(categorizeFile('subdir/INSIGHTS.md', '**/INSIGHTS.md')).toBe('insights');
  });

  it('returns "specs" when matched glob contains "specs"', () => {
    expect(categorizeFile('specs/security-baseline.md', '**/specs/**/*.md')).toBe('specs');
    expect(categorizeFile('specs/api/public-api.md', '**/specs/**/*.md')).toBe('specs');
  });

  it('returns "docs" when matched glob contains "docs"', () => {
    expect(categorizeFile('docs/architecture.md', '**/docs/**/*.md')).toBe('docs');
  });

  it('returns "other" when glob matches neither specs nor docs and filename is not INSIGHTS.md', () => {
    expect(categorizeFile('README.md', '**/*.md')).toBe('other');
  });

  it('INSIGHTS.md takes priority over a glob that also contains "specs"', () => {
    // The filename check comes first in the implementation.
    expect(categorizeFile('specs/INSIGHTS.md', '**/specs/**/*.md')).toBe('insights');
  });
});

// ====================================================== validateFilename

describe('validateFilename', () => {
  it('accepts valid alphanumeric-with-hyphens-and-underscores .md filenames', () => {
    expect(validateFilename('security-baseline.md')).toEqual({ ok: true });
    expect(validateFilename('INSIGHTS.md')).toEqual({ ok: true });
    expect(validateFilename('api_spec.md')).toEqual({ ok: true });
    expect(validateFilename('my-doc-1.md')).toEqual({ ok: true });
  });

  it('rejects filenames missing the .md extension', () => {
    const result = validateFilename('readme.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/\.md/i);
  });

  it('rejects filenames with spaces', () => {
    const result = validateFilename('my doc.md');
    expect(result.ok).toBe(false);
  });

  it('rejects filenames with forward slash (path segment)', () => {
    const result = validateFilename('specs/nested.md');
    expect(result.ok).toBe(false);
  });

  it('rejects path traversal sequences (..)', () => {
    const result = validateFilename('../../etc/passwd.md');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/path traversal/i);
  });

  it('rejects a filename that is just ".."', () => {
    const result = validateFilename('..');
    expect(result.ok).toBe(false);
  });
});

// ====================================================== validateContent

describe('validateContent', () => {
  it('accepts content within the 500 KB limit', () => {
    const content = 'x'.repeat(100);
    expect(validateContent(content)).toEqual({ ok: true });
  });

  it('rejects content that exceeds 500 KB', () => {
    // MAX_FILE_SIZE is 500 * 1024 bytes
    const overLimit = 'a'.repeat(MAX_FILE_SIZE + 1);
    const result = validateContent(overLimit);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/500/);
  });

  it('accepts content exactly at the limit boundary', () => {
    const atLimit = 'a'.repeat(MAX_FILE_SIZE);
    expect(validateContent(atLimit)).toEqual({ ok: true });
  });
});
