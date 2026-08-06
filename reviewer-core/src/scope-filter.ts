import type { Finding } from '@devdigest/shared';

/**
 * Scope filter — post-grounding pass to demote out-of-scope suggestions.
 *
 * Applied AFTER groundFindings() (the mandatory citation gate). This is a
 * separate best-effort step; it NEVER drops CRITICAL findings regardless of scope.
 *
 * Rules:
 *  1. CRITICAL findings are ALWAYS kept, no annotation added
 *  2. WARNING findings STAY but get annotated with out_of_scope=true when
 *     the finding clearly falls outside declared scope
 *  3. SUGGESTION findings outside scope are demoted (moved to `demoted`)
 *     — one unique area kept per out-of-scope category to avoid total silence
 *
 * "Outside scope" is a fuzzy match: does the finding's file or rationale text
 * overlap with any out_of_scope item? We use simple case-insensitive substring
 * matching — no embeddings, no NLP.
 */

export interface ScopeFilterResult {
  /** Findings that pass (including annotated out-of-scope WARNINGs). */
  kept: Finding[];
  /** SUGGESTION findings demoted as out-of-scope. */
  demoted: Finding[];
}

/** A minimal intent shape — we only need in_scope / out_of_scope for filtering. */
export interface ScopeIntent {
  in_scope: string[];
  out_of_scope: string[];
}

/**
 * Check whether a finding appears to be outside the declared scope.
 * Uses fuzzy substring matching against the out_of_scope list.
 */
function isOutOfScope(finding: Finding, intent: ScopeIntent): boolean {
  if (intent.out_of_scope.length === 0) return false;

  const haystack = [
    finding.file,
    finding.title,
    finding.rationale,
    finding.suggestion ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return intent.out_of_scope.some((item) => {
    // Match meaningful keywords from the out_of_scope item
    const keywords = item
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3); // skip short/stop words
    return keywords.length > 0 && keywords.some((kw) => haystack.includes(kw));
  });
}

/**
 * Filter findings by scope after grounding.
 *
 * @param findings  Grounded findings from the review engine.
 * @param intent    Declared intent with in_scope / out_of_scope lists.
 */
export function filterByScope(findings: Finding[], intent: ScopeIntent): ScopeFilterResult {
  const kept: Finding[] = [];
  const demoted: Finding[] = [];

  // Track one demoted finding per out-of-scope area to avoid total silence
  const demotedAreas = new Set<string>();

  for (const finding of findings) {
    // Rule 1: CRITICAL is NEVER filtered
    if (finding.severity === 'CRITICAL') {
      kept.push(finding);
      continue;
    }

    const outOfScope = isOutOfScope(finding, intent);

    if (!outOfScope) {
      kept.push(finding);
      continue;
    }

    // Rule 2: WARNING → keep but annotate (by tagging the rationale)
    if (finding.severity === 'WARNING') {
      kept.push({
        ...finding,
        rationale: `[Out of scope for this PR] ${finding.rationale}`,
      });
      continue;
    }

    // Rule 3: SUGGESTION → demote (keep one per out-of-scope area)
    const area = finding.category;
    if (!demotedAreas.has(area)) {
      demotedAreas.add(area);
      // Keep the first occurrence as an annotated finding
      kept.push({
        ...finding,
        rationale: `[Out of scope for this PR] ${finding.rationale}`,
      });
    } else {
      demoted.push(finding);
    }
  }

  return { kept, demoted };
}
