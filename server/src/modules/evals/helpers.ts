/**
 * Eval Pipeline — helpers: diff parsing, DTO mapping.
 */

import type { UnifiedDiff, DiffHunk } from '@devdigest/shared';
import type * as t from '../../db/schema.js';

// ===========================================================================
// parseDiffToUnifiedDiff — convert unified diff text to UnifiedDiff shape
// ===========================================================================

type EvalCaseRow = typeof t.evalCases.$inferSelect;
type EvalRunRow = typeof t.evalRuns.$inferSelect;
type EvalBatchRow = typeof t.evalBatches.$inferSelect;

/**
 * Parse a unified diff text string into the UnifiedDiff shape expected by
 * reviewPullRequest(). Extracts file paths, hunks, and new-side line numbers.
 *
 * Handles standard unified diff format:
 *   diff --git a/path b/path
 *   --- a/path
 *   +++ b/path
 *   @@ -old_start,old_lines +new_start,new_lines @@
 *   <lines>
 */
export function parseDiffToUnifiedDiff(diffText: string): UnifiedDiff {
  const files: UnifiedDiff['files'] = [];
  let currentFile: (typeof files)[0] | null = null;
  let currentHunk: DiffHunk | null = null;
  let newLineCounter = 0;

  const lines = diffText.split('\n');

  for (const line of lines) {
    // New file header: diff --git a/path b/path
    if (line.startsWith('diff --git ')) {
      if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
      if (currentFile) files.push(currentFile);
      currentFile = { path: '', additions: 0, deletions: 0, hunks: [] };
      currentHunk = null;
      // Extract path from: diff --git a/path b/path → use b/ side
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      if (match?.[1]) currentFile.path = match[1];
      continue;
    }

    // +++ line gives us the new file path (handles renames)
    if (line.startsWith('+++ ') && currentFile) {
      const path = line.slice(4).replace(/^b\//, '');
      if (path !== '/dev/null') {
        currentFile.path = path;
        // If a hunk was already started (shouldn't normally happen), update its file
        if (currentHunk) currentHunk.file = path;
      }
      continue;
    }

    // Skip --- lines
    if (line.startsWith('--- ')) continue;

    // Hunk header: @@ -old_start,old_lines +new_start,new_lines @@
    if (line.startsWith('@@ ') && currentFile) {
      if (currentHunk) currentFile.hunks.push(currentHunk);
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      const newStart = match ? parseInt(match[1] ?? '1', 10) : 1;
      newLineCounter = newStart;
      currentHunk = {
        file: currentFile.path, // path may be updated later by +++ line; that's ok for post-parse
        oldStart: 0,
        oldLines: 0,
        newStart,
        newLines: 0,
        newLineNumbers: [],
      };
      continue;
    }

    if (!currentFile || !currentHunk) continue;

    if (line.startsWith('+')) {
      currentFile.additions++;
      currentHunk.newLines++;
      currentHunk.newLineNumbers.push(newLineCounter++);
    } else if (line.startsWith('-')) {
      currentFile.deletions++;
      currentHunk.oldLines++;
    } else if (line.startsWith(' ') || line === '') {
      // Context line
      currentHunk.newLines++;
      currentHunk.oldLines++;
      newLineCounter++;
    }
  }

  // Flush last hunk/file
  if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
  if (currentFile) files.push(currentFile);

  // Filter out files with no path (binary, incomplete headers)
  const validFiles = files.filter((f) => f.path.length > 0);

  return {
    raw: diffText,
    files: validFiles,
  };
}

// ===========================================================================
// DTO mappers
// ===========================================================================

export function toEvalCaseDto(row: EvalCaseRow) {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: (row.expectedOutput ?? []) as unknown[],
    notes: row.notes ?? null,
    source_finding_id: row.sourceFindingId ?? null,
  };
}

export function toEvalRunDto(row: EvalRunRow) {
  return {
    id: row.id,
    case_id: row.caseId,
    batch_id: row.batchId ?? null,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput ?? null,
    pass: row.pass ?? null,
    recall: row.recall ?? null,
    precision: row.precision ?? null,
    citation_accuracy: row.citationAccuracy ?? null,
    duration_ms: row.durationMs ?? null,
    cost_usd: row.costUsd ?? null,
    error: row.error ?? null,
  };
}

export function toEvalBatchDto(row: EvalBatchRow) {
  return {
    id: row.id,
    owner_id: row.ownerId,
    owner_kind: row.ownerKind,
    agent_version: row.agentVersion,
    ran_at: row.ranAt.toISOString(),
    status: row.status,
    recall: row.recall ?? null,
    precision: row.precision ?? null,
    citation_accuracy: row.citationAccuracy ?? null,
    traces_total: row.tracesTotal ?? null,
    traces_passed: row.tracesPassed ?? null,
    cost_usd: row.costUsd ?? null,
    duration_ms: row.durationMs ?? null,
  };
}
