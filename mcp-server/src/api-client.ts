import type { Agent, ReviewRecord, RunSummary, ConventionCandidate, BlastRadiusResult } from "./types.js";

export class DevDigestClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(
    baseUrl: string = "http://localhost:3001",
    headers: Record<string, string> = {}
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.headers = {
      "Content-Type": "application/json",
      ...headers,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  listAgents(): Promise<Agent[]> {
    return this.request<Agent[]>("GET", "/agents");
  }

  runReview(
    prId: string,
    agentId: string
  ): Promise<{ runs: { run_id: string; agent_id: string }[] }> {
    return this.request("POST", `/pulls/${prId}/review`, { agentId });
  }

  getAllRuns(prId: string): Promise<RunSummary[]> {
    return this.request<RunSummary[]>("GET", `/pulls/${prId}/runs`);
  }

  getReviews(prId: string): Promise<ReviewRecord[]> {
    return this.request<ReviewRecord[]>("GET", `/pulls/${prId}/reviews`);
  }

  getConventions(repoId: string): Promise<ConventionCandidate[]> {
    return this.request<ConventionCandidate[]>(
      "GET",
      `/repos/${repoId}/conventions`
    );
  }

  getBlastRadius(prId: string): Promise<BlastRadiusResult> {
    return this.request<BlastRadiusResult>("GET", `/pulls/${prId}/blast`);
  }
}
