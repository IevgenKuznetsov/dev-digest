import { describe, it, expect } from 'vitest';
import {
  lineRangeOverlaps,
  jaccardLineRange,
  computePass,
  computeCitationAccuracy,
  computeBatchMetrics,
} from './scoring.js';
import type { ExpectedOutputItem } from '@devdigest/shared';
import type { Finding } from '@devdigest/shared';

// Minimal Finding stub
function makeFinding(file: string, start: number, end: number): Finding {
  return {
    id: crypto.randomUUID(),
    file,
    start_line: start,
    end_line: end,
    title: 'Test finding',
    severity: 'WARNING',
    category: 'bug',
    rationale: 'test',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifecta_components: null,
    accepted_at: null,
    dismissed_at: null,
  } as unknown as Finding;
}

function makeItem(
  type: 'must_find' | 'must_not_flag',
  file: string,
  start: number,
  end: number,
): ExpectedOutputItem {
  return { type, file, start_line: start, end_line: end };
}

// ============================================================ lineRangeOverlaps

describe('lineRangeOverlaps', () => {
  it('returns true when ranges overlap', () => {
    expect(lineRangeOverlaps({ start: 1, end: 5 }, { start: 3, end: 8 })).toBe(true);
  });
  it('returns true when ranges are adjacent (inclusive)', () => {
    expect(lineRangeOverlaps({ start: 1, end: 3 }, { start: 3, end: 5 })).toBe(true);
  });
  it('returns false when ranges do not overlap', () => {
    expect(lineRangeOverlaps({ start: 1, end: 3 }, { start: 5, end: 8 })).toBe(false);
  });
  it('returns true for identical ranges', () => {
    expect(lineRangeOverlaps({ start: 5, end: 10 }, { start: 5, end: 10 })).toBe(true);
  });
});

// ============================================================ jaccardLineRange

describe('jaccardLineRange', () => {
  it('returns 1.0 for identical ranges', () => {
    expect(jaccardLineRange({ start: 1, end: 5 }, { start: 1, end: 5 })).toBe(1);
  });
  it('returns 0 for non-overlapping ranges', () => {
    expect(jaccardLineRange({ start: 1, end: 3 }, { start: 5, end: 8 })).toBe(0);
  });
  it('returns fractional for partial overlap', () => {
    // intersection: [3,3] = 1 line; union: [1,5] = 5 lines → 1/5 = 0.2
    const r = jaccardLineRange({ start: 1, end: 3 }, { start: 3, end: 5 });
    expect(r).toBeCloseTo(1 / 5);
  });
});

// ============================================================ computePass

describe('computePass', () => {
  it('returns true for empty expected_output (EDGE-9)', () => {
    expect(computePass([], [])).toBe(true);
    expect(computePass([], [makeFinding('a.ts', 1, 5)])).toBe(true);
  });

  it('returns true when must_find is satisfied', () => {
    const expected = [makeItem('must_find', 'a.ts', 1, 5)];
    const actual = [makeFinding('a.ts', 3, 8)]; // overlaps
    expect(computePass(expected, actual)).toBe(true);
  });

  it('returns false when must_find is not satisfied', () => {
    const expected = [makeItem('must_find', 'a.ts', 1, 5)];
    const actual = [makeFinding('a.ts', 10, 15)]; // no overlap
    expect(computePass(expected, actual)).toBe(false);
  });

  it('returns false when must_find is not in actual (different file)', () => {
    const expected = [makeItem('must_find', 'a.ts', 1, 5)];
    const actual = [makeFinding('b.ts', 1, 5)]; // different file
    expect(computePass(expected, actual)).toBe(false);
  });

  it('returns true when must_not_flag is satisfied (no match)', () => {
    const expected = [makeItem('must_not_flag', 'a.ts', 1, 5)];
    const actual = [makeFinding('a.ts', 10, 15)]; // no overlap
    expect(computePass(expected, actual)).toBe(true);
  });

  it('returns false when must_not_flag is violated (match exists)', () => {
    const expected = [makeItem('must_not_flag', 'a.ts', 1, 5)];
    const actual = [makeFinding('a.ts', 3, 8)]; // overlaps
    expect(computePass(expected, actual)).toBe(false);
  });

  it('returns true when only must_not_flag with zero actual findings (EDGE-8)', () => {
    const expected = [makeItem('must_not_flag', 'a.ts', 1, 5)];
    expect(computePass(expected, [])).toBe(true);
  });
});

// ============================================================ computeCitationAccuracy

describe('computeCitationAccuracy', () => {
  it('returns null when no must_find items (EDGE-8, EDGE-9)', () => {
    expect(computeCitationAccuracy([], [])).toBeNull();
    expect(computeCitationAccuracy([makeItem('must_not_flag', 'a.ts', 1, 5)], [])).toBeNull();
  });

  it('returns 1.0 when must_find is exactly matched', () => {
    const expected = [makeItem('must_find', 'a.ts', 1, 5)];
    const actual = [makeFinding('a.ts', 1, 5)];
    expect(computeCitationAccuracy(expected, actual)).toBe(1);
  });

  it('returns 0 when must_find is not matched', () => {
    const expected = [makeItem('must_find', 'a.ts', 1, 5)];
    const actual = [makeFinding('a.ts', 10, 15)];
    expect(computeCitationAccuracy(expected, actual)).toBe(0);
  });

  it('averages jaccard across matched must_find items (only matched count)', () => {
    // Per spec: "averaged across all matched must_find items"
    // Unmatched must_find items are not averaged — only matches count.
    const expected = [
      makeItem('must_find', 'a.ts', 1, 5), // perfect match → 1.0
      makeItem('must_find', 'b.ts', 10, 20), // not matched → not counted
    ];
    const actual = [makeFinding('a.ts', 1, 5)]; // only first matches
    const result = computeCitationAccuracy(expected, actual);
    expect(result).toBeCloseTo(1.0); // only 1 match, jaccard = 1.0
  });
});

// ============================================================ computeBatchMetrics

describe('computeBatchMetrics', () => {
  it('handles empty cases array', () => {
    const m = computeBatchMetrics([]);
    expect(m.traces_total).toBe(0);
    expect(m.traces_passed).toBe(0);
    expect(m.recall).toBe(1.0); // no must_find expectations → trivially 1.0
    expect(m.precision).toBe(1.0); // 0 findings, 0 expectations → precision = 1.0
    expect(m.citation_accuracy).toBeNull();
  });

  it('computes recall correctly', () => {
    const cases = [
      {
        expected: [makeItem('must_find', 'a.ts', 1, 5)],
        actual: [makeFinding('a.ts', 1, 5)], // matched
        pass: true,
        citationAccuracy: 1.0,
      },
      {
        expected: [makeItem('must_find', 'b.ts', 1, 5)],
        actual: [], // not matched
        pass: false,
        citationAccuracy: null,
      },
    ];
    const m = computeBatchMetrics(cases);
    expect(m.recall).toBeCloseTo(0.5); // 1 / 2 must_find matched
    expect(m.traces_total).toBe(2);
    expect(m.traces_passed).toBe(1);
  });

  it('computes precision correctly', () => {
    const cases = [
      {
        expected: [makeItem('must_find', 'a.ts', 1, 5)],
        actual: [makeFinding('a.ts', 1, 5), makeFinding('a.ts', 10, 15)], // 1 matches, 1 is a false positive
        pass: false,
        citationAccuracy: 1.0,
      },
    ];
    const m = computeBatchMetrics(cases);
    // 1 finding matches must_find / 2 total findings = 0.5
    expect(m.precision).toBeCloseTo(0.5);
  });

  it('sets recall to 1.0 when no must_find expectations (EDGE-8)', () => {
    const cases = [
      {
        expected: [makeItem('must_not_flag', 'a.ts', 1, 5)],
        actual: [],
        pass: true,
        citationAccuracy: null,
      },
    ];
    const m = computeBatchMetrics(cases);
    expect(m.recall).toBe(1.0); // no must_find → trivially 1.0
    // precision: (0 + 1) / (0 + 1 + 0) = 1.0 (must_not_flag satisfied, no noise)
    expect(m.precision).toBe(1.0);
  });

  it('sets precision to 0 when 0 findings and there are must_find expectations', () => {
    const cases = [
      {
        expected: [makeItem('must_find', 'a.ts', 1, 5)],
        actual: [],
        pass: false,
        citationAccuracy: null,
      },
    ];
    const m = computeBatchMetrics(cases);
    // 0 matched, 0 satisfiedMustNotFlag / (1 must_find + 0 + 0) = 0
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0); // 0 matched / 1 must_find
  });

  it('averages citation_accuracy across non-null cases', () => {
    const cases = [
      { expected: [], actual: [], pass: true, citationAccuracy: 0.8 },
      { expected: [], actual: [], pass: true, citationAccuracy: 0.4 },
      { expected: [], actual: [], pass: true, citationAccuracy: null },
    ];
    const m = computeBatchMetrics(cases);
    expect(m.citation_accuracy).toBeCloseTo(0.6);
  });

  it('precision with must_not_flag satisfied', () => {
    // 1 must_not_flag, 0 findings → satisfied
    const cases = [
      {
        expected: [makeItem('must_not_flag', 'a.ts', 1, 5)],
        actual: [],
        pass: true,
        citationAccuracy: null,
      },
    ];
    const m = computeBatchMetrics(cases);
    // (0 + 1) / (0 + 1 + 0) = 1.0
    expect(m.precision).toBe(1.0);
  });

  it('precision with must_not_flag violated', () => {
    // 1 must_not_flag, 1 finding overlapping it → violated (not satisfied)
    const cases = [
      {
        expected: [makeItem('must_not_flag', 'a.ts', 1, 5)],
        actual: [makeFinding('a.ts', 3, 8)], // overlaps → violation
        pass: false,
        citationAccuracy: null,
      },
    ];
    const m = computeBatchMetrics(cases);
    // satisfiedMustNotFlag=0, unmatchedFindings=0 (finding matched the must_not_flag expectation)
    // (0 + 0) / (0 + 1 + 0) = 0.0
    expect(m.precision).toBe(0.0);
  });

  it('precision with mixed must_find + must_not_flag + noise', () => {
    // 1 must_find (matched), 1 must_not_flag (satisfied), 3 extra unmatched findings
    const cases = [
      {
        expected: [
          makeItem('must_find', 'a.ts', 1, 5),
          makeItem('must_not_flag', 'b.ts', 10, 20),
        ],
        actual: [
          makeFinding('a.ts', 1, 5),      // matches must_find
          makeFinding('c.ts', 1, 5),      // unmatched (noise)
          makeFinding('c.ts', 10, 15),    // unmatched (noise)
          makeFinding('c.ts', 20, 25),    // unmatched (noise)
        ],
        pass: false,
        citationAccuracy: 1.0,
      },
    ];
    const m = computeBatchMetrics(cases);
    // matchedMustFind=1, satisfiedMustNotFlag=1, totalMustFind=1, totalMustNotFlag=1, unmatchedFindings=3
    // (1 + 1) / (1 + 1 + 3) = 2/5 = 0.4
    expect(m.precision).toBeCloseTo(0.4);
  });

  it('precision with only must_not_flag, all satisfied', () => {
    // 0 must_find, 2 must_not_flag both silent, 0 findings
    const cases = [
      {
        expected: [
          makeItem('must_not_flag', 'a.ts', 1, 5),
          makeItem('must_not_flag', 'b.ts', 10, 20),
        ],
        actual: [],
        pass: true,
        citationAccuracy: null,
      },
    ];
    const m = computeBatchMetrics(cases);
    // (0 + 2) / (0 + 2 + 0) = 1.0
    expect(m.precision).toBe(1.0);
    expect(m.recall).toBe(1.0);
  });

  it('precision with only must_not_flag, one violated', () => {
    // 0 must_find, 2 must_not_flag (1 silent, 1 flagged), 0 extra findings
    const cases = [
      {
        expected: [
          makeItem('must_not_flag', 'a.ts', 1, 5),   // silent → satisfied
          makeItem('must_not_flag', 'b.ts', 10, 20), // overlapping finding → violated
        ],
        actual: [
          makeFinding('b.ts', 12, 18), // overlaps b.ts 10-20
        ],
        pass: false,
        citationAccuracy: null,
      },
    ];
    const m = computeBatchMetrics(cases);
    // satisfiedMustNotFlag=1 (a.ts silent), violated=1 (b.ts flagged)
    // unmatchedFindings=0 (b.ts finding matched the must_not_flag expectation)
    // (0 + 1) / (0 + 2 + 0) = 0.5
    expect(m.precision).toBeCloseTo(0.5);
    expect(m.recall).toBe(1.0);
  });
});
