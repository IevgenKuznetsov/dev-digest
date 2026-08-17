-- FIX-P1: Unique partial index to make the context-scan enqueue atomic.
-- Prevents duplicate active scan jobs for the same repo at the DB level,
-- eliminating the TOCTOU race between isScanRunning() and enqueue().
CREATE UNIQUE INDEX IF NOT EXISTS jobs_context_scan_active
  ON jobs(kind, (payload->>'repoId'))
  WHERE kind = 'context-scan' AND status IN ('queued', 'running');
