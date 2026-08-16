/**
 * Unit tests for OnboardingService.
 * All DB / LLM / filesystem access is mocked — runs without Docker.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs/promises before any imports that use it.
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('mock file content\n'.repeat(10)),
}));

// Mock walkClone.
vi.mock('../repo-intel/pipeline/walk.js', () => ({
  walkClone: vi.fn().mockResolvedValue({ files: ['src/index.ts', 'src/app.ts'], stats: {} }),
}));

// Mock resolveFeatureModel so DB access is not needed in service unit tests.
vi.mock('../settings/feature-models.js', () => ({
  resolveFeatureModel: vi.fn().mockResolvedValue({
    provider: 'openai',
    model: 'deepseek/deepseek-v4-flash',
  }),
}));

import { OnboardingService } from './service.js';
import type { Container } from '../../platform/container.js';
import { ExternalServiceError, AppError } from '../../platform/errors.js';
import { TimeoutError } from '../../platform/resilience.js';
import type { IndexState } from '../repo-intel/types.js';
import type { OnboardingResult, OnboardingGenerating } from './service.js';
import { SECTION_ORDER } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-1';
const REPO_ID = 'repo-1';

const FULL_INDEX_STATE: IndexState = {
  repoId: REPO_ID,
  status: 'full',
  filesIndexed: 100,
  filesSkipped: 0,
  durationMs: 1000,
  lastIndexedSha: 'abc123def',
  indexerVersion: 3,
  updatedAt: new Date(),
  degraded: false,
};

const DEGRADED_INDEX_STATE: IndexState = {
  repoId: REPO_ID,
  status: 'degraded',
  filesIndexed: 0,
  filesSkipped: 0,
  durationMs: 0,
  lastIndexedSha: '',
  indexerVersion: 3,
  updatedAt: new Date(),
  degraded: true,
  degradedReason: 'no_data',
};

function makeSections() {
  return SECTION_ORDER.map((kind) => ({
    kind,
    title: `Title ${kind}`,
    body: 'body',
    diagram: kind === 'architecture' ? 'flowchart LR\n  A --> B' : null,
    links: [],
  }));
}

function makeUpsertRow() {
  return {
    repoId: REPO_ID,
    json: { sections: makeSections() },
    model: 'deepseek/deepseek-v4-flash',
    inputSha: 'abc123def',
    generatedAt: new Date('2026-01-01'),
  };
}

// ---------------------------------------------------------------------------
// Mock container builder
// ---------------------------------------------------------------------------

function makeMockRepo(overrides: Partial<{
  getByRepoId: ReturnType<typeof vi.fn>;
  getRepoForWorkspace: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  getFileFacts: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    getByRepoId: overrides.getByRepoId ?? vi.fn().mockResolvedValue(null),
    getRepoForWorkspace: overrides.getRepoForWorkspace ?? vi.fn().mockResolvedValue({
      id: REPO_ID,
      workspaceId: WORKSPACE_ID,
      owner: 'acme',
      name: 'test-repo',
      defaultBranch: 'main',
      clonePath: '/tmp/clone',
    }),
    upsert: overrides.upsert ?? vi.fn().mockResolvedValue(makeUpsertRow()),
    getFileFacts: overrides.getFileFacts ?? vi.fn().mockResolvedValue([]),
  };
}

function makeMockRepoIntel(indexState: IndexState = FULL_INDEX_STATE) {
  return {
    getIndexState: vi.fn().mockResolvedValue(indexState),
    getRepoMap: vi.fn().mockResolvedValue({ text: 'repo map text', tokens: 100, cached: false }),
    getTopFilesByRank: vi.fn().mockResolvedValue(['src/index.ts', 'src/app.ts']),
    getCriticalPaths: vi.fn().mockResolvedValue([['src/index.ts', 'src/app.ts']]),
  };
}

function makeMockLlm(structuredResult: unknown = { sections: makeSections() }) {
  return {
    completeStructured: vi.fn().mockResolvedValue({
      data: structuredResult,
      model: 'deepseek/deepseek-v4-flash',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(structuredResult),
      attempts: 1,
    }),
    complete: vi.fn(),
    embed: vi.fn(),
    id: 'openai' as const,
    listModels: vi.fn(),
  };
}

function makeContainer(overrides: {
  llm?: ReturnType<typeof makeMockLlm>;
  repoIntel?: ReturnType<typeof makeMockRepoIntel>;
  repo?: ReturnType<typeof makeMockRepo>;
} = {}): Container {
  const mockLlm = overrides.llm ?? makeMockLlm();
  const mockRepoIntel = overrides.repoIntel ?? makeMockRepoIntel();

  return {
    db: {} as never,
    config: { cloneDir: '/tmp' } as never,
    llm: vi.fn().mockResolvedValue(mockLlm),
    repoIntel: mockRepoIntel,
    secrets: {} as never,
    auth: {} as never,
    jobs: {} as never,
    runBus: {} as never,
    git: {} as never,
    agentsRepo: {} as never,
    reviewRepo: {} as never,
    codeIndex: {} as never,
    depgraph: {} as never,
    tokenizer: {} as never,
    projectContext: {} as never,
  } as unknown as Container;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnboardingService', () => {
  let mockRepo: ReturnType<typeof makeMockRepo>;

  beforeEach(() => {
    // Reset module-level lock between tests by patching the service fresh each time.
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---- getOnboarding ----

  describe('getOnboarding', () => {
    it('returns null when no onboarding row exists', async () => {
      mockRepo = makeMockRepo({ getByRepoId: vi.fn().mockResolvedValue(null) });
      const service = new OnboardingService(makeContainer());
      // Patch the internal repo (normally would use injection, but this is simpler for testing).
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      const result = await service.getOnboarding(WORKSPACE_ID, REPO_ID);
      expect(result).toBeNull();
    });

    it('returns the onboarding DTO when a row exists', async () => {
      mockRepo = makeMockRepo({ getByRepoId: vi.fn().mockResolvedValue(makeUpsertRow()) });
      const service = new OnboardingService(makeContainer());
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      const result = (await service.getOnboarding(WORKSPACE_ID, REPO_ID)) as OnboardingResult;
      expect(result).not.toBeNull();
      expect(result.sections).toHaveLength(5);
      expect(result.model).toBe('deepseek/deepseek-v4-flash');
      expect(result.input_sha).toBe('abc123def');
    });

    it('throws NotFoundError when repo not in workspace', async () => {
      mockRepo = makeMockRepo({
        getRepoForWorkspace: vi.fn().mockResolvedValue(null),
      });
      const service = new OnboardingService(makeContainer());
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      await expect(service.getOnboarding(WORKSPACE_ID, REPO_ID)).rejects.toMatchObject({
        code: 'not_found',
        statusCode: 404,
      });
    });
  });

  // ---- generateOnboarding ----

  describe('generateOnboarding', () => {
    it('successful generation returns sections with post-parse normalization', async () => {
      // The LLM returns diagram on critical_paths (should be normalized to null).
      const sectionsWithDiagram = SECTION_ORDER.map((kind) => ({
        kind,
        title: `Title ${kind}`,
        body: 'body',
        diagram: 'flowchart LR\n  A --> B', // non-architecture gets set to null
        links: [],
      }));

      mockRepo = makeMockRepo({
        upsert: vi.fn().mockImplementation((_repoId, data) => ({
          repoId: REPO_ID,
          json: data.json,
          model: data.model,
          inputSha: data.inputSha,
          generatedAt: new Date(),
        })),
      });
      const container = makeContainer({
        llm: makeMockLlm({ sections: sectionsWithDiagram }),
      });
      const service = new OnboardingService(container);
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      const result = await service.generateOnboarding(WORKSPACE_ID, REPO_ID, 'en');
      expect(result.sections).toHaveLength(5);

      // architecture section should keep its diagram.
      const arch = result.sections.find((s) => s.kind === 'architecture');
      expect(arch?.diagram).toBe('flowchart LR\n  A --> B');

      // All non-architecture sections should have diagram = null.
      for (const s of result.sections) {
        if (s.kind !== 'architecture') {
          expect(s.diagram).toBeNull();
        }
      }
    });

    it('uses fallback data when index state is degraded', async () => {
      mockRepo = makeMockRepo({
        upsert: vi.fn().mockResolvedValue(makeUpsertRow()),
      });
      const degradedRepoIntel = makeMockRepoIntel(DEGRADED_INDEX_STATE);
      const container = makeContainer({ repoIntel: degradedRepoIntel });
      const service = new OnboardingService(container);
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      await service.generateOnboarding(WORKSPACE_ID, REPO_ID, 'en');

      // getRepoMap, getTopFilesByRank, getCriticalPaths should NOT be called in fallback.
      expect(degradedRepoIntel.getRepoMap).not.toHaveBeenCalled();
      expect(degradedRepoIntel.getTopFilesByRank).not.toHaveBeenCalled();
      expect(degradedRepoIntel.getCriticalPaths).not.toHaveBeenCalled();
    });

    it('uses fallback when status is failed (broadened degradation condition)', async () => {
      const failedState: IndexState = {
        ...FULL_INDEX_STATE,
        status: 'failed',
        degradedReason: 'index_failed',
      };
      mockRepo = makeMockRepo({ upsert: vi.fn().mockResolvedValue(makeUpsertRow()) });
      const failedRepoIntel = makeMockRepoIntel(failedState);
      const container = makeContainer({ repoIntel: failedRepoIntel });
      const service = new OnboardingService(container);
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      await service.generateOnboarding(WORKSPACE_ID, REPO_ID, 'en');

      expect(failedRepoIntel.getRepoMap).not.toHaveBeenCalled();
    });

    it('uses fallback when lastIndexedSha is empty (partial index with no SHA)', async () => {
      const partialNoSha: IndexState = {
        ...FULL_INDEX_STATE,
        status: 'partial',
        lastIndexedSha: '', // empty string → falsy
      };
      mockRepo = makeMockRepo({ upsert: vi.fn().mockResolvedValue(makeUpsertRow()) });
      const noShaRepoIntel = makeMockRepoIntel(partialNoSha);
      const container = makeContainer({ repoIntel: noShaRepoIntel });
      const service = new OnboardingService(container);
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      await service.generateOnboarding(WORKSPACE_ID, REPO_ID, 'en');

      expect(noShaRepoIntel.getRepoMap).not.toHaveBeenCalled();
    });

    it('logs warning but continues when getCriticalPaths returns [] (AC-X4)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockRepo = makeMockRepo({ upsert: vi.fn().mockResolvedValue(makeUpsertRow()) });
      const repoIntelEmptyPaths = makeMockRepoIntel();
      repoIntelEmptyPaths.getCriticalPaths = vi.fn().mockResolvedValue([]);
      const container = makeContainer({ repoIntel: repoIntelEmptyPaths });
      const service = new OnboardingService(container);
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      await service.generateOnboarding(WORKSPACE_ID, REPO_ID, 'en');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('getCriticalPaths() returned []'));
      warnSpy.mockRestore();
    });

    it('throws AppError(409) when generation is already in-progress', async () => {
      // This test verifies the lock mechanism prevents concurrent calls.
      mockRepo = makeMockRepo({
        upsert: vi.fn().mockResolvedValue(makeUpsertRow()),
      });

      // Create a slow LLM to keep the lock held.
      let resolveLlm!: (v: unknown) => void;
      const slowLlm = {
        completeStructured: vi.fn().mockReturnValue(
          new Promise((resolve) => { resolveLlm = resolve; }),
        ),
        id: 'openai' as const,
        listModels: vi.fn(),
        complete: vi.fn(),
        embed: vi.fn(),
      };
      const container = makeContainer({ llm: slowLlm as typeof slowLlm & { listModels: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn>; embed: ReturnType<typeof vi.fn> } });
      const service = new OnboardingService(container);
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      // Start first generation (will be in-flight).
      const first = service.generateOnboarding(WORKSPACE_ID, REPO_ID, 'en');

      // Second should immediately reject.
      await expect(service.generateOnboarding(WORKSPACE_ID, REPO_ID, 'en')).rejects.toMatchObject({
        code: 'conflict',
        statusCode: 409,
      });

      // Resolve and clean up.
      resolveLlm({
        data: { sections: makeSections() },
        model: 'deepseek/deepseek-v4-flash',
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        raw: '{}',
        attempts: 1,
      });
      await first.catch(() => {});
    });

    // ---- Error handling ----

    it('re-throws TimeoutError as AppError(504) and does NOT call upsert (AC-X5)', async () => {
      const upsertSpy = vi.fn();
      mockRepo = makeMockRepo({ upsert: upsertSpy });
      const timeoutLlm = makeMockLlm();
      timeoutLlm.completeStructured = vi.fn().mockRejectedValue(new TimeoutError(60_000));
      const container = makeContainer({ llm: timeoutLlm });
      const service = new OnboardingService(container);
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      await expect(service.generateOnboarding(WORKSPACE_ID, REPO_ID, 'en')).rejects.toMatchObject({
        code: 'llm_timeout',
        statusCode: 504,
      });
      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('re-throws parse-exhaustion ExternalServiceError as AppError(500) and does NOT call upsert (AC-X1)', async () => {
      const upsertSpy = vi.fn();
      mockRepo = makeMockRepo({ upsert: upsertSpy });
      const parseLlm = makeMockLlm();
      parseLlm.completeStructured = vi.fn().mockRejectedValue(
        new ExternalServiceError('OpenAI structured output failed schema validation', { raw: '{}' }),
      );
      const container = makeContainer({ llm: parseLlm });
      const service = new OnboardingService(container);
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      await expect(service.generateOnboarding(WORKSPACE_ID, REPO_ID, 'en')).rejects.toMatchObject({
        code: 'parse_failure',
        statusCode: 500,
      });
      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('propagates network ExternalServiceError as-is (502) and does NOT call upsert (AC-X7)', async () => {
      const upsertSpy = vi.fn();
      mockRepo = makeMockRepo({ upsert: upsertSpy });
      const networkLlm = makeMockLlm();
      const networkError = new ExternalServiceError('OpenAI request failed: ECONNREFUSED');
      networkLlm.completeStructured = vi.fn().mockRejectedValue(networkError);
      const container = makeContainer({ llm: networkLlm });
      const service = new OnboardingService(container);
      (service as unknown as { repo: typeof mockRepo }).repo = mockRepo;

      const err = await service.generateOnboarding(WORKSPACE_ID, REPO_ID, 'en').catch((e) => e);
      expect(err).toBe(networkError);
      expect(err.statusCode).toBe(502);
      expect(upsertSpy).not.toHaveBeenCalled();
    });
  });
});
