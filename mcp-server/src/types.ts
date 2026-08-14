export interface Agent {
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  enabled: boolean;
}

export interface FindingRecord {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  rationale: string;
}

export interface ReviewRecord {
  id: string;
  run_id: string | null;
  agent_name: string;
  verdict: string;
  summary: string;
  score: number;
  findings: FindingRecord[];
}

export interface ConventionCandidate {
  id: string;
  rule: string;
  evidence_path: string;
  confidence: number;
  accepted: boolean;
}

export interface BlastChangedSymbol {
  file: string;
  name: string;
  kind: string;
}

export interface BlastCaller {
  file: string;
  symbol: string;
  via_symbol: string;
  line: number;
  rank: number;
}

export interface BlastRadiusResult {
  changed_symbols: BlastChangedSymbol[];
  callers: BlastCaller[];
  impacted_endpoints: string[];
  facts_by_file?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  reason?: string;
}

export interface RunSummary {
  run_id: string;
  agent_name: string;
  status: string;
  score: number | null;
  findings_count: number;
}

export interface Repo {
  id: string;
  owner: string;
  name: string;
  full_name: string;
}

export interface PrMeta {
  id: string;
  number: number;
  title: string;
  author: string;
  status: string;
}
