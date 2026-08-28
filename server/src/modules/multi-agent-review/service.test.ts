/**
 * Unit tests for MultiAgentReviewService validation logic.
 *
 * These tests verify the service-layer guards:
 *   - Empty agent_ids array → 400 AppError
 *   - Agent ID not in workspace → 404 NotFoundError
 *
 * DB access is fully mocked via vi.mock so these run without Docker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiAgentReviewService } from './service.js';
import { AppError, NotFoundError } from '../../platform/errors.js';

// ---------------------------------------------------------------------------
// Mock all dependencies that touch the DB or external services
// ---------------------------------------------------------------------------

vi.mock('./repository.js', () => ({
  MultiAgentReviewRepository: vi.fn().mockImplementation(() => ({
    createMultiAgentRun: vi.fn().mockResolvedValue('mar-1'),
    getMultiAgentRun: vi.fn().mockResolvedValue(null),
    getRunsForMultiAgent: vi.fn().mockResolvedValue([]),
    getFindingsForConflict: vi.fn().mockResolvedValue([]),
    getLatestCompletedRuns: vi.fn().mockResolvedValue(new Map()),
  })),
}));

vi.mock('../reviews/repository.js', () => ({
  ReviewRepository: vi.fn().mockImplementation(() => ({
    getPull: vi.fn().mockResolvedValue({
      id: 'pr-1',
      repoId: 'repo-1',
      number: 42,
      workspaceId: 'ws-1',
    }),
    getRepo: vi.fn().mockResolvedValue({ id: 'repo-1', fullName: 'acme/repo' }),
    createAgentRun: vi.fn().mockResolvedValue('run-1'),
  })),
}));

vi.mock('../reviews/run-executor.js', () => ({
  ReviewRunExecutor: vi.fn().mockImplementation(() => ({
    executeRuns: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Container stub — provides agentsRepo with controllable getById / list
// ---------------------------------------------------------------------------

const mockGetById = vi.fn();
const mockListAgents = vi.fn();

function makeContainer() {
  return {
    db: {} as never,
    agentsRepo: {
      getById: mockGetById,
      list: mockListAgents,
    },
  } as never;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MultiAgentReviewService — validation', () => {
  let service: MultiAgentReviewService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MultiAgentReviewService(makeContainer());
    mockListAgents.mockResolvedValue([]);
  });

  describe('createAndExecute — empty agent_ids', () => {
    it('throws AppError 400 when agent_ids is empty', async () => {
      await expect(
        service.createAndExecute('ws-1', 'pr-1', []),
      ).rejects.toThrow(AppError);

      await expect(
        service.createAndExecute('ws-1', 'pr-1', []),
      ).rejects.toMatchObject({ statusCode: 400, code: 'invalid_run_request' });
    });
  });

  describe('createAndExecute — agent not in workspace', () => {
    it('throws NotFoundError with code agent_not_found for an unknown agent ID', async () => {
      // The repo returns null for an unknown agent
      mockGetById.mockResolvedValue(null);

      await expect(
        service.createAndExecute('ws-1', 'pr-1', ['00000000-0000-0000-0000-deadbeef0001']),
      ).rejects.toThrow(NotFoundError);

      await expect(
        service.createAndExecute('ws-1', 'pr-1', ['00000000-0000-0000-0000-deadbeef0001']),
      ).rejects.toMatchObject({ details: { code: 'agent_not_found' } });
    });

    it('proceeds normally when all agents are valid', async () => {
      mockGetById.mockResolvedValue({
        id: 'agent-1',
        name: 'Security Reviewer',
        provider: 'openai',
        model: 'gpt-4o-mini',
        workspaceId: 'ws-1',
      });

      const result = await service.createAndExecute('ws-1', 'pr-1', ['agent-1']);
      expect(result).toMatchObject({ id: expect.any(String), runs: expect.any(Array) });
    });

    it('rejects when the second agent ID is invalid even if the first is valid', async () => {
      mockGetById
        .mockResolvedValueOnce({
          id: 'agent-1',
          name: 'Security',
          provider: 'openai',
          model: 'gpt-4o-mini',
          workspaceId: 'ws-1',
        })
        .mockResolvedValueOnce(null); // second agent not found

      await expect(
        service.createAndExecute('ws-1', 'pr-1', ['agent-1', 'agent-bad']),
      ).rejects.toMatchObject({ details: { code: 'agent_not_found' } });
    });
  });
});
