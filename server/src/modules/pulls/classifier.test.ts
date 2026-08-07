import { describe, it, expect } from 'vitest';
import { classifyFile, buildSmartDiff, TOO_BIG_THRESHOLD } from './classifier.js';

// ---- classifyFile -----------------------------------------------------------

describe('classifyFile — boilerplate', () => {
  it.each([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'Gemfile.lock',
    'Cargo.lock',
    'composer.lock',
    'poetry.lock',
    'go.sum',
  ])('classifies %s as boilerplate (lock file)', (path) => {
    expect(classifyFile(path)).toBe('boilerplate');
  });

  it.each([
    'dist/bundle.js',
    'dist/index.cjs',
    'build/output.js',
    '.next/static/chunks/app.js',
    'node_modules/lodash/index.js',
    'vendor/autoload.php',
    'coverage/lcov-report/index.html',
    'src/__generated__/types.ts',
  ])('classifies %s as boilerplate (build/generated dir)', (path) => {
    expect(classifyFile(path)).toBe('boilerplate');
  });

  it.each([
    'src/App.test.tsx.snap',
    'components/Button.snap',
    'app.min.js',
    'styles.min.css',
    'main.js.map',
    'proto/service.pb.go',
    'proto/service_pb2.py',
  ])('classifies %s as boilerplate (suffix)', (path) => {
    expect(classifyFile(path)).toBe('boilerplate');
  });

  it.each([
    'src/schema.generated.ts',
    'api/client.g.ts',
    'lib/model.g.dart',
    'lcov.info',
    'coverage/lcov.info',
  ])('classifies %s as boilerplate (substring marker)', (path) => {
    expect(classifyFile(path)).toBe('boilerplate');
  });
});

describe('classifyFile — wiring', () => {
  it.each([
    'src/index.ts',
    'src/index.js',
    'src/index.tsx',
    'src/index.jsx',
    'src/components/Button/index.ts',
    'index.ts',
  ])('classifies %s as wiring (index barrel)', (path) => {
    expect(classifyFile(path)).toBe('wiring');
  });

  it.each([
    'package.json',
    'Cargo.toml',
    'go.mod',
    'pyproject.toml',
    'Gemfile',
    'pom.xml',
    'build.gradle',
  ])('classifies %s as wiring (package manifest)', (path) => {
    expect(classifyFile(path)).toBe('wiring');
  });

  it.each([
    'tsconfig.json',
    'tsconfig.base.json',
    'tsconfig.app.json',
    'vite.config.ts',
    'vite.config.js',
    'vite.config.mjs',
    'jest.config.ts',
    'vitest.config.ts',
    'vitest.config.mjs',
    'next.config.js',
    'next.config.mjs',
    'biome.json',
  ])('classifies %s as wiring (config file)', (path) => {
    expect(classifyFile(path)).toBe('wiring');
  });

  it.each([
    '.eslintrc',
    '.eslintrc.json',
    '.eslintrc.js',
    '.prettierrc',
    '.prettierrc.json',
  ])('classifies %s as wiring (linter/formatter config)', (path) => {
    expect(classifyFile(path)).toBe('wiring');
  });

  it.each([
    'Dockerfile',
    'Dockerfile.dev',
    'docker-compose.yml',
    'docker-compose.yaml',
    'docker-compose.override.yml',
  ])('classifies %s as wiring (docker)', (path) => {
    expect(classifyFile(path)).toBe('wiring');
  });

  it.each(['.env', '.env.local', '.env.production'])(
    'classifies %s as wiring (env file)',
    (path) => {
      expect(classifyFile(path)).toBe('wiring');
    },
  );

  it.each([
    '.github/workflows/ci.yml',
    '.github/CODEOWNERS',
    '.circleci/config.yml',
    '.gitlab-ci.yml',
    'Jenkinsfile',
  ])('classifies %s as wiring (CI/CD)', (path) => {
    expect(classifyFile(path)).toBe('wiring');
  });

  it.each(['migrations/0001_init.sql', 'drizzle/meta/0000_snapshot.json'])(
    'classifies %s as wiring (migration)',
    (path) => {
      expect(classifyFile(path)).toBe('wiring');
    },
  );
});

describe('classifyFile — core (default)', () => {
  it.each([
    'src/services/auth.ts',
    'src/utils/format.ts',
    'src/components/Button.tsx',
    'src/app/routes.ts',
    'lib/classifier.ts',
    'server/handler.go',
    'app/models/user.py',
  ])('classifies %s as core', (path) => {
    expect(classifyFile(path)).toBe('core');
  });
});

// ---- buildSmartDiff ---------------------------------------------------------

describe('buildSmartDiff', () => {
  const files = [
    { path: 'src/auth.ts', additions: 50, deletions: 10 },
    { path: 'package-lock.json', additions: 200, deletions: 100 },
    { path: 'src/index.ts', additions: 5, deletions: 2 },
    { path: 'src/utils.ts', additions: 20, deletions: 5 },
  ];

  it('groups files by role in core → wiring → boilerplate order', () => {
    const result = buildSmartDiff(files, new Map());
    const roles = result.groups.map((g) => g.role);
    // core first, then wiring, then boilerplate
    const coreIdx = roles.indexOf('core');
    const wiringIdx = roles.indexOf('wiring');
    const boilerplateIdx = roles.indexOf('boilerplate');
    expect(coreIdx).toBeLessThan(wiringIdx);
    expect(wiringIdx).toBeLessThan(boilerplateIdx);
  });

  it('puts auth.ts and utils.ts in core group', () => {
    const result = buildSmartDiff(files, new Map());
    const core = result.groups.find((g) => g.role === 'core')!;
    const paths = core.files.map((f) => f.path);
    expect(paths).toContain('src/auth.ts');
    expect(paths).toContain('src/utils.ts');
  });

  it('puts index.ts in wiring group', () => {
    const result = buildSmartDiff(files, new Map());
    const wiring = result.groups.find((g) => g.role === 'wiring')!;
    expect(wiring.files.map((f) => f.path)).toContain('src/index.ts');
  });

  it('puts package-lock.json in boilerplate group', () => {
    const result = buildSmartDiff(files, new Map());
    const boilerplate = result.groups.find((g) => g.role === 'boilerplate')!;
    expect(boilerplate.files.map((f) => f.path)).toContain('package-lock.json');
  });

  it('sorts files within group by finding count desc, then total lines desc', () => {
    const twoFiles = [
      { path: 'src/a.ts', additions: 100, deletions: 0 },
      { path: 'src/b.ts', additions: 10, deletions: 0 },
    ];
    const findings = new Map([['src/b.ts', [1, 2, 3]]]);
    const result = buildSmartDiff(twoFiles, findings);
    const core = result.groups.find((g) => g.role === 'core')!;
    // b.ts has 3 findings → comes first
    expect(core.files[0]!.path).toBe('src/b.ts');
    expect(core.files[1]!.path).toBe('src/a.ts');
  });

  it('uses additions+deletions as tiebreaker when finding counts are equal', () => {
    const twoFiles = [
      { path: 'src/small.ts', additions: 5, deletions: 0 },
      { path: 'src/large.ts', additions: 100, deletions: 50 },
    ];
    const result = buildSmartDiff(twoFiles, new Map());
    const core = result.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.path).toBe('src/large.ts');
  });

  it('populates finding_lines from the findings map', () => {
    const singleFile = [{ path: 'src/auth.ts', additions: 10, deletions: 0 }];
    const findings = new Map([['src/auth.ts', [5, 12, 42]]]);
    const result = buildSmartDiff(singleFile, findings);
    const file = result.groups[0]!.files[0]!;
    expect(file.finding_lines).toEqual([5, 12, 42]);
  });

  it('sets finding_lines to [] when no findings for a file', () => {
    const singleFile = [{ path: 'src/no-findings.ts', additions: 5, deletions: 0 }];
    const result = buildSmartDiff(singleFile, new Map());
    expect(result.groups[0]!.files[0]!.finding_lines).toEqual([]);
  });

  it('sets pseudocode_summary to null', () => {
    const result = buildSmartDiff(
      [{ path: 'src/auth.ts', additions: 1, deletions: 0 }],
      new Map(),
    );
    expect(result.groups[0]!.files[0]!.pseudocode_summary).toBeNull();
  });

  it('omits empty groups from the output', () => {
    // Only a boilerplate file — no core or wiring
    const result = buildSmartDiff(
      [{ path: 'package-lock.json', additions: 10, deletions: 0 }],
      new Map(),
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.role).toBe('boilerplate');
  });

  it('computes total_lines as sum of additions + deletions', () => {
    const result = buildSmartDiff(files, new Map());
    const expected = files.reduce((s, f) => s + f.additions + f.deletions, 0);
    expect(result.split_suggestion.total_lines).toBe(expected);
  });

  it(`sets too_big = true when total lines > ${TOO_BIG_THRESHOLD}`, () => {
    const bigFiles = [{ path: 'src/auth.ts', additions: 400, deletions: 200 }];
    const result = buildSmartDiff(bigFiles, new Map());
    expect(result.split_suggestion.too_big).toBe(true);
  });

  it(`sets too_big = false when total lines <= ${TOO_BIG_THRESHOLD}`, () => {
    const smallFiles = [{ path: 'src/auth.ts', additions: 100, deletions: 50 }];
    const result = buildSmartDiff(smallFiles, new Map());
    expect(result.split_suggestion.too_big).toBe(false);
  });

  it('returns proposed_splits as empty array', () => {
    const result = buildSmartDiff(files, new Map());
    expect(result.split_suggestion.proposed_splits).toEqual([]);
  });
});
