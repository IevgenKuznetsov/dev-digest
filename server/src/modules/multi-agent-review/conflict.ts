import type { Conflict, ConflictTake } from '@devdigest/shared';

/**
 * Internal type for a finding as fetched from the DB for conflict computation.
 * Distinct from AgentColumnFinding (which omits end_line).
 * Not exported via the shared contract.
 */
export type ConflictFinding = {
  agent_id: string;
  agent_name: string;
  file: string;
  start_line: number;
  /** end_line is available from the findings table and needed for overlap detection. */
  end_line: number;
  severity: string;
  category: string;
  title: string;
};

/**
 * Compute conflicts from a set of findings across multiple agents.
 *
 * Algorithm:
 * 1. Group findings by file.
 * 2. Within each file, cluster findings with overlapping [start_line, end_line]
 *    intervals. Two intervals overlap if a1 <= b2 && b1 <= a2.
 * 3. For each cluster, check if agents disagree (different severity/category,
 *    or only a subset of agents flagged the region).
 * 4. Only emit a Conflict when at least one agent's take differs from the others.
 *
 * Agents absent from a cluster get an 'ignored' take (they did not flag the region).
 *
 * Performance guard: if total findings exceed 500, returns empty array to avoid
 * O(n^2) performance on unusually large runs.
 */
export function computeConflicts(findings: ConflictFinding[], allAgentIds: string[]): Conflict[] {
  // Guard against O(n^2) on pathological inputs
  if (findings.length > 500) return [];
  if (allAgentIds.length <= 1) return [];

  // Group by file
  const byFile = new Map<string, ConflictFinding[]>();
  for (const f of findings) {
    let group = byFile.get(f.file);
    if (!group) {
      group = [];
      byFile.set(f.file, group);
    }
    group.push(f);
  }

  const conflicts: Conflict[] = [];

  for (const [, fileFindings] of byFile) {
    const clusters = clusterByOverlap(fileFindings);

    for (const cluster of clusters) {
      const conflict = buildConflict(cluster, allAgentIds);
      if (conflict) conflicts.push(conflict);
    }
  }

  return conflicts;
}

/**
 * Cluster findings within a single file by overlapping line ranges.
 * Uses a sweep-merge approach: sort by start_line, then merge intervals greedily.
 */
function clusterByOverlap(findings: ConflictFinding[]): ConflictFinding[][] {
  if (findings.length === 0) return [];

  // Sort by start_line for the sweep
  const sorted = [...findings].sort((a, b) => a.start_line - b.start_line);

  const clusters: ConflictFinding[][] = [];
  let currentCluster: ConflictFinding[] = [sorted[0]!];
  let currentMax = sorted[0]!.end_line;

  for (let i = 1; i < sorted.length; i++) {
    const f = sorted[i]!;
    // Overlaps if f.start_line <= current max end_line
    if (f.start_line <= currentMax) {
      currentCluster.push(f);
      currentMax = Math.max(currentMax, f.end_line);
    } else {
      clusters.push(currentCluster);
      currentCluster = [f];
      currentMax = f.end_line;
    }
  }
  clusters.push(currentCluster);

  return clusters;
}

/**
 * Build a Conflict from a cluster of overlapping findings.
 * Returns null if all agents agree (same severity + category or all same take).
 */
function buildConflict(cluster: ConflictFinding[], allAgentIds: string[]): Conflict | null {
  // Map agent_id → finding (an agent may have multiple findings in a cluster;
  // use the most severe one or the first one found).
  const agentFindings = new Map<string, ConflictFinding>();
  for (const f of cluster) {
    if (!agentFindings.has(f.agent_id)) {
      agentFindings.set(f.agent_id, f);
    }
  }

  // Build takes for every agent in the run
  const takes: ConflictTake[] = allAgentIds.map((agentId) => {
    const f = agentFindings.get(agentId);
    if (!f) {
      // Agent did not flag this region
      return {
        agent_id: agentId,
        persona: '',
        verdict: 'ignored' as const,
        note: '',
      };
    }
    return {
      agent_id: agentId,
      persona: f.agent_name,
      verdict: f.severity as ConflictTake['verdict'],
      note: f.title,
    };
  });

  // Check if all takes are identical (no conflict)
  const distinctVerdicts = new Set(takes.map((t) => t.verdict));
  const allSameCategory =
    cluster.length > 0 &&
    takes.every((t) => {
      const f = agentFindings.get(t.agent_id);
      return f?.category === cluster[0]?.category;
    });

  if (distinctVerdicts.size === 1 && allSameCategory) return null;

  // Use the representative finding for file/line/title
  const representative = cluster[0]!;
  return {
    file: representative.file,
    line: representative.start_line,
    title: representative.title,
    takes,
  };
}
