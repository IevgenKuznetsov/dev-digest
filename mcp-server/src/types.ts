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

export interface BlastRadius {
  changed_symbols: string[];
  downstream: string[];
  summary: string;
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
