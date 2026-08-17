#!/usr/bin/env node
/**
 * PostToolUse hook — called after every Agent tool invocation.
 * Appends one JSONL entry to .claude/session-log.jsonl.
 * If the log's last entry is from a previous calendar day, rotates
 * the log to .claude/session-log-YYYY-MM-DD.jsonl before appending.
 *
 * Fields captured:
 *   ts           — ISO timestamp of the hook firing
 *   subagent     — subagent_type from TOOL_INPUT (defaults to 'general-purpose')
 *   description  — description from TOOL_INPUT, or first 80 chars of prompt as fallback
 *   background   — true if run_in_background was set
 *   model        — model override from TOOL_INPUT, or null (agent uses its default)
 *   tokens       — total_tokens from <usage> block in TOOL_OUTPUT (foreground only)
 *   tool_uses    — tool_uses count from <usage> block (foreground only)
 *   duration_ms  — duration_ms from <usage> block (foreground only)
 *
 * Note: background agents fire PostToolUse at launch time, before completion,
 * so tokens/tool_uses/duration_ms are always null for background agents.
 */
const fs = require('fs');
const logPath = '.claude/session-log.jsonl';

try {
  const input = JSON.parse(process.env.TOOL_INPUT || '{}');
  const today = new Date().toISOString().slice(0, 10);

  // Rotate log when a new calendar day starts
  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      try {
        const last = JSON.parse(lines[lines.length - 1]);
        if (last.ts && last.ts.slice(0, 10) !== today) {
          fs.renameSync(logPath, `.claude/session-log-${last.ts.slice(0, 10)}.jsonl`);
        }
      } catch (_) { /* malformed last line — leave log as-is */ }
    }
  }

  // Description: prefer explicit field, fall back to first 80 chars of prompt
  const description = (input.description || '').trim() ||
    (input.prompt || '').replace(/\s+/g, ' ').slice(0, 80);

  // Extract token usage from TOOL_OUTPUT.
  // TOOL_OUTPUT for foreground agents contains the agent's output text, which
  // includes a <usage>total_tokens: N\ntool_uses: N\nduration_ms: N</usage> block.
  // Background agents fire before completion, so TOOL_OUTPUT has no usage block.
  let tokens = null;
  let toolUses = null;
  let durationMs = null;

  try {
    const rawOutput = process.env.TOOL_OUTPUT || '';
    // TOOL_OUTPUT may be a JSON string wrapping the actual output text
    let outputText = rawOutput;
    try {
      const parsed = JSON.parse(rawOutput);
      if (typeof parsed === 'string') outputText = parsed;
      else if (parsed && typeof parsed.output === 'string') outputText = parsed.output;
      else if (parsed && typeof parsed.result === 'string') outputText = parsed.result;
    } catch (_) { /* not JSON — use raw string directly */ }

    const usageMatch = outputText.match(/<usage>([\s\S]*?)<\/usage>/);
    if (usageMatch) {
      const usageText = usageMatch[1];
      const mTokens = usageText.match(/total_tokens:\s*(\d+)/);
      const mTools = usageText.match(/tool_uses:\s*(\d+)/);
      const mDuration = usageText.match(/duration_ms:\s*(\d+)/);
      if (mTokens) tokens = parseInt(mTokens[1], 10);
      if (mTools) toolUses = parseInt(mTools[1], 10);
      if (mDuration) durationMs = parseInt(mDuration[1], 10);
    }
  } catch (_) { /* never let output parsing crash the hook */ }

  const entry = {
    ts: new Date().toISOString(),
    subagent: input.subagent_type || 'general-purpose',
    description: description.slice(0, 120),
    background: !!input.run_in_background,
    model: input.model || null,
    tokens,
    tool_uses: toolUses,
    duration_ms: durationMs,
  };

  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
} catch (_) { /* never crash the hook */ }
