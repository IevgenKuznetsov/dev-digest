import { describe, it, expect } from 'vitest';
import { PerfWindow, CiAgentPerfRow, AgentPerformance, CostSlice, CiInstallationView } from './ci-v2.js';
import { CiInstallation } from './eval-ci.js';

describe('PerfWindow', () => {
  it('accepts the allow-listed values', () => {
    expect(PerfWindow.safeParse('7').success).toBe(true);
    expect(PerfWindow.safeParse('30').success).toBe(true);
    expect(PerfWindow.safeParse('90').success).toBe(true);
  });

  it('rejects values outside the allow-list', () => {
    expect(PerfWindow.safeParse('45').success).toBe(false);
    expect(PerfWindow.safeParse('0').success).toBe(false);
    expect(PerfWindow.safeParse('').success).toBe(false);
    expect(PerfWindow.safeParse(30).success).toBe(false);
    expect(PerfWindow.safeParse(undefined).success).toBe(false);
  });
});

describe('CiAgentPerfRow', () => {
  const base = {
    agent_id: 'a1',
    agent_name: 'Reviewer',
    runs: 12,
    avg_cost_usd: 0.05,
    avg_duration_ms: 1200,
    accept_rate: 0.75,
    trend: 'up' as const,
    last_run_at: '2026-08-01T00:00:00.000Z',
  };

  it('accepts a fully populated row', () => {
    expect(CiAgentPerfRow.safeParse(base).success).toBe(true);
  });

  it('round-trips a null accept_rate (no accepted/dismissed findings)', () => {
    const result = CiAgentPerfRow.safeParse({ ...base, accept_rate: null, trend: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accept_rate).toBeNull();
      expect(result.data.trend).toBeNull();
    }
  });

  it('rejects an invalid trend value', () => {
    expect(CiAgentPerfRow.safeParse({ ...base, trend: 'sideways' }).success).toBe(false);
  });
});

describe('CostSlice', () => {
  it('accepts a key + cost_usd pair', () => {
    expect(CostSlice.safeParse({ key: 'gpt-4o', cost_usd: 1.23 }).success).toBe(true);
  });

  it('rejects a missing cost_usd', () => {
    expect(CostSlice.safeParse({ key: 'gpt-4o' }).success).toBe(false);
  });
});

describe('AgentPerformance', () => {
  const validPayload = {
    window: '30' as const,
    total_runs: 253,
    total_cost_usd: 12.5,
    cost_delta_usd: 2.1,
    avg_accept_rate: 0.8,
    most_active_agent: { agent_id: 'a1', agent_name: 'Reviewer', runs: 100 },
    agents: [
      {
        agent_id: 'a1',
        agent_name: 'Reviewer',
        runs: 100,
        avg_cost_usd: 0.05,
        avg_duration_ms: 1200,
        accept_rate: 0.8,
        trend: 'flat' as const,
        last_run_at: '2026-08-01T00:00:00.000Z',
      },
    ],
    cost_by_agent: [{ key: 'a1', cost_usd: 5 }],
    cost_by_model: [{ key: 'gpt-4o', cost_usd: 5 }],
  };

  it('accepts a fully populated dashboard payload', () => {
    expect(AgentPerformance.safeParse(validPayload).success).toBe(true);
  });

  it('accepts null cost_delta_usd, avg_accept_rate, and most_active_agent (empty state)', () => {
    const result = AgentPerformance.safeParse({
      ...validPayload,
      total_runs: 0,
      total_cost_usd: 0,
      cost_delta_usd: null,
      avg_accept_rate: null,
      most_active_agent: null,
      agents: [],
      cost_by_agent: [],
      cost_by_model: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a window outside the allow-list', () => {
    expect(AgentPerformance.safeParse({ ...validPayload, window: '45' }).success).toBe(false);
  });
});

describe('CiInstallationView', () => {
  const baseInstallation = {
    id: 'inst-1',
    agent_id: 'a1',
    repo: 'owner/name',
    target_type: 'gha' as const,
    installed_at: '2026-08-01T00:00:00.000Z',
  };

  it('accepts a base CiInstallation object parsed by CiInstallation itself', () => {
    expect(CiInstallation.safeParse(baseInstallation).success).toBe(true);
  });

  it('extends CiInstallation with agent_version, last_status, last_run_at', () => {
    const result = CiInstallationView.safeParse({
      ...baseInstallation,
      agent_version: 3,
      last_status: 'succeeded',
      last_run_at: '2026-08-02T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null agent_version, last_status, and last_run_at (no runs yet)', () => {
    const result = CiInstallationView.safeParse({
      ...baseInstallation,
      agent_version: null,
      last_status: null,
      last_run_at: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when the base CiInstallation fields are missing', () => {
    const result = CiInstallationView.safeParse({
      agent_version: 1,
      last_status: null,
      last_run_at: null,
    });
    expect(result.success).toBe(false);
  });
});
