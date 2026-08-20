/**
 * Eval Pipeline — pure scoring functions (zero LLM calls).
 *
 * All functions take explicit inputs and return deterministic outputs.
 * No side effects, no DB access, no I/O.
 */

import type { ExpectedOutputItem } from '@devdigest/shared';
import type { Finding } from '@devdigest/shared';

// ===========================================================================
// Line-range primitives
// ===========================================================================

export function lineRangeOverlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * Jaccard similarity of two line ranges:
 * |intersection| / |union|
 */
export function jaccardLineRange(
  a: { start: number; end: number },
  b: { start: number; end: number },
): number {
  if (!lineRangeOverlaps(a, b)) return 0;
  const intersectionStart = Math.max(a.start, b.start);
  const intersectionEnd = Math.min(a.end, b.end);
  const intersection = intersectionEnd - intersectionStart + 1;
  const unionStart = Math.min(a.start, b.start);
  const unionEnd = Math.max(a.end, b.end);
  const union = unionEnd - unionStart + 1;
  return union === 0 ? 0 : intersection / union;
}

// ===========================================================================
// Per-case scoring
// ===========================================================================

/**
 * Determine whether a single expected item is satisfied by any actual finding.
 * Overlap = same file AND line ranges intersect.
 */
function findMatch(item: ExpectedOutputItem, actualFindings: Finding[]): Finding | undefined {
  return actualFindings.find(
    (f) =>
      f.file === item.file &&
      lineRangeOverlaps(
        { start: item.start_line, end: item.end_line },
        { start: f.start_line, end: f.end_line },
      ),
  );
}

/**
 * computePass — true if ALL expectations are satisfied:
 *   must_find:      an overlapping actual finding exists
 *   must_not_flag:  NO overlapping actual finding exists
 *
 * Empty expected_output array → pass: true (no expectations to violate — EDGE-9).
 */
export function computePass(
  expected: ExpectedOutputItem[],
  actualFindings: Finding[],
): boolean {
  if (expected.length === 0) return true;
  for (const item of expected) {
    const match = findMatch(item, actualFindings);
    if (item.type === 'must_find' && !match) return false;
    if (item.type === 'must_not_flag' && match) return false;
  }
  return true;
}

/**
 * computeCitationAccuracy — Jaccard similarity of line ranges for matched
 * must_find items, averaged across all matched items.
 * Returns null if there are no must_find items (EDGE-8, EDGE-9).
 */
export function computeCitationAccuracy(
  expected: ExpectedOutputItem[],
  actualFindings: Finding[],
): number | null {
  const mustFinds = expected.filter((e) => e.type === 'must_find');
  if (mustFinds.length === 0) return null;

  const scores: number[] = [];
  for (const item of mustFinds) {
    const match = findMatch(item, actualFindings);
    if (match) {
      scores.push(
        jaccardLineRange(
          { start: item.start_line, end: item.end_line },
          { start: match.start_line, end: match.end_line },
        ),
      );
    }
    // unmatched must_find contributes 0 to citation accuracy
    // (penalizes citation accuracy when a finding is missed)
  }
  if (scores.length === 0) return 0;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

// ===========================================================================
// Batch aggregation
// ===========================================================================

export interface CaseResult {
  expected: ExpectedOutputItem[];
  actual: Finding[];
  pass: boolean | null;
  citationAccuracy: number | null;
}

export interface BatchMetrics {
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  traces_passed: number;
  traces_total: number;
}

/**
 * computeBatchMetrics — aggregate recall, precision, citation_accuracy, pass counts.
 *
 * Formulas from the spec:
 *   recall = (must_find expectations matched) / (total must_find expectations)
 *   precision = (actual findings that match a must_find) / (total actual findings)
 *   citation_accuracy = average of per-case citation_accuracy (non-null only)
 *
 * Division-by-zero guards:
 *   totalMustFind === 0  → recall = null (no must_find expectations → N/A)
 *   totalFindings === 0 AND only must_not_flag expectations → precision = 1.0
 *   totalFindings === 0 WITH must_find expectations → precision = null
 */
export function computeBatchMetrics(cases: CaseResult[]): BatchMetrics {
  let totalMustFind = 0;
  let matchedMustFind = 0;
  let totalActualFindings = 0;
  let findingsMatchingMustFind = 0;
  const citationAccuracies: number[] = [];

  const tracesTotal = cases.length;
  let tracesPassed = 0;

  for (const c of cases) {
    if (c.pass === true) tracesPassed++;
    if (c.citationAccuracy !== null) citationAccuracies.push(c.citationAccuracy);

    const mustFinds = c.expected.filter((e) => e.type === 'must_find');
    totalMustFind += mustFinds.length;

    // Count how many must_find expectations were matched
    for (const item of mustFinds) {
      const match = findMatch(item, c.actual);
      if (match) matchedMustFind++;
    }

    // Precision numerator: actual findings that match ANY must_find
    totalActualFindings += c.actual.length;
    for (const f of c.actual) {
      const matchesMustFind = c.expected.some(
        (e) =>
          e.type === 'must_find' &&
          f.file === e.file &&
          lineRangeOverlaps(
            { start: e.start_line, end: e.end_line },
            { start: f.start_line, end: f.end_line },
          ),
      );
      if (matchesMustFind) findingsMatchingMustFind++;
    }
  }

  // Recall
  const recall = totalMustFind === 0 ? null : matchedMustFind / totalMustFind;

  // Precision
  let precision: number | null;
  if (totalActualFindings === 0) {
    // No findings produced at all
    precision = totalMustFind === 0 ? 1.0 : null;
  } else {
    precision = findingsMatchingMustFind / totalActualFindings;
  }

  // Citation accuracy (average of non-null per-case values)
  const citation_accuracy =
    citationAccuracies.length > 0
      ? citationAccuracies.reduce((s, v) => s + v, 0) / citationAccuracies.length
      : null;

  return {
    recall,
    precision,
    citation_accuracy,
    traces_passed: tracesPassed,
    traces_total: tracesTotal,
  };
}
