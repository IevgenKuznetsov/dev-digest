#!/usr/bin/env node
/**
 * PostToolUse hook — called after every Agent tool invocation.
 * Appends one JSONL entry to .claude/session-log.jsonl.
 * If the log's last entry is from a previous calendar day, rotates
 * the log to .claude/session-log-YYYY-MM-DD.jsonl before appending.
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

  const entry = {
    ts: new Date().toISOString(),
    subagent: input.subagent_type || 'general-purpose',
    description: (input.description || '').slice(0, 120),
    background: !!input.run_in_background,
    model: input.model || null,
  };

  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
} catch (_) { /* never crash the hook */ }
