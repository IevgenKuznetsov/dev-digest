/**
 * Smart Diff classifier — deterministic file-role assignment.
 * Pure domain logic: zero external dependencies (no DB, no Fastify, no adapters).
 *
 * Roles:
 *   core       — business-logic files reviewers should focus on
 *   wiring     — config, CI, index barrels, migrations, manifests
 *   boilerplate — lock files, dist output, snapshots, generated code, source maps
 */
import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';

// ---- Pattern registry (exported for testability and future tuning) ----------

export const PATTERNS = {
  boilerplate: {
    /** Exact file names that are always boilerplate. */
    lockFiles: [
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'Gemfile.lock',
      'Cargo.lock',
      'composer.lock',
      'poetry.lock',
      'go.sum',
    ] as const,
    /** Path segments (lowercased) that indicate generated/build output. */
    dirs: [
      'dist/',
      'build/',
      '.next/',
      'node_modules/',
      'vendor/',
      'coverage/',
      '__generated__/',
    ] as const,
    /** File suffixes (lowercased) that indicate boilerplate. */
    suffixes: [
      '.min.js',
      '.min.css',
      '.snap',
      '.map',
      '.pb.go',
      '_pb2.py',
    ] as const,
    /** Substrings (lowercased) that indicate generated files. */
    substrings: [
      '.generated.',
      '.g.ts',
      '.g.dart',
      'lcov.info',
    ] as const,
  },
  wiring: {
    /** Exact base names that are always wiring. */
    manifestFiles: [
      'package.json',
      'Cargo.toml',
      'go.mod',
      'pyproject.toml',
      'Gemfile',
      'pom.xml',
      'build.gradle',
    ] as const,
    /** Exact base names for index barrel re-exports. */
    indexFiles: [
      'index.ts',
      'index.js',
      'index.tsx',
      'index.jsx',
    ] as const,
    /** Config file suffixes (lowercased). */
    configSuffixes: [
      '.config.ts',
      '.config.js',
      '.config.mjs',
      '.config.cjs',
      'jest.config.ts',
      'jest.config.js',
      'vitest.config.ts',
      'vitest.config.mjs',
      'biome.json',
    ] as const,
    /** CI/CD path segments (lowercased). */
    ciSegments: [
      '.github/',
      '.circleci/',
      '.gitlab-ci',
    ] as const,
    /** Migration path segments (lowercased). */
    migrationDirs: [
      'migrations/',
      'drizzle/',
    ] as const,
  },
} as const;

/**
 * Classify a file path into a `SmartDiffRole`.
 * Classification order: boilerplate → wiring → core (default).
 */
export function classifyFile(filePath: string): SmartDiffRole {
  const name = filePath.split('/').pop() ?? filePath;
  const lower = filePath.toLowerCase();
  const lowerName = name.toLowerCase();

  // ---- Boilerplate --------------------------------------------------------
  if ((PATTERNS.boilerplate.lockFiles as readonly string[]).includes(name)) return 'boilerplate';
  if (PATTERNS.boilerplate.dirs.some((d) => lower.includes(d))) return 'boilerplate';
  if (PATTERNS.boilerplate.suffixes.some((s) => lowerName.endsWith(s))) return 'boilerplate';
  if (PATTERNS.boilerplate.substrings.some((sub) => lower.includes(sub))) return 'boilerplate';

  // ---- Wiring -------------------------------------------------------------
  if ((PATTERNS.wiring.manifestFiles as readonly string[]).includes(name)) return 'wiring';
  if ((PATTERNS.wiring.indexFiles as readonly string[]).includes(name)) return 'wiring';

  // tsconfig*.json variants
  if (/^tsconfig.*\.json$/i.test(name)) return 'wiring';

  // *.config.* suffixes
  if (PATTERNS.wiring.configSuffixes.some((s) => lowerName.endsWith(s))) return 'wiring';

  // eslintrc / prettierrc (may have extensions or be bare)
  if (lowerName.startsWith('.eslintrc') || lowerName.startsWith('.prettierrc')) return 'wiring';

  // Dockerfile variants
  if (name === 'Dockerfile' || name.startsWith('Dockerfile.')) return 'wiring';

  // docker-compose variants
  if (name.startsWith('docker-compose')) return 'wiring';

  // .env variants
  if (name === '.env' || name.startsWith('.env.')) return 'wiring';

  // Jenkinsfile
  if (name === 'Jenkinsfile') return 'wiring';

  // CI/CD paths
  if (PATTERNS.wiring.ciSegments.some((ci) => lower.includes(ci))) return 'wiring';

  // Migration directories
  if (PATTERNS.wiring.migrationDirs.some((m) => lower.includes(m))) return 'wiring';

  // ---- Core (default) -----------------------------------------------------
  return 'core';
}

// ---- Build SmartDiff from classified file data ----------------------------

/** Total changed lines threshold for the `too_big` split suggestion. */
export const TOO_BIG_THRESHOLD = 500;

const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

interface FileInput {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * Build a `SmartDiff` from classified file data and a findings map.
 *
 * @param files          List of PR files (path + add/del counts).
 * @param findingsByFile Map of file path → array of finding start_line values.
 */
export function buildSmartDiff(
  files: FileInput[],
  findingsByFile: Map<string, number[]>,
): SmartDiff {
  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  const grouped = new Map<SmartDiffRole, SmartDiffFile[]>(ROLE_ORDER.map((r) => [r, []]));

  for (const file of files) {
    const role = classifyFile(file.path);
    const findingLines = findingsByFile.get(file.path) ?? [];
    const smartFile: SmartDiffFile = {
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLines,
      pseudocode_summary: null,
    };
    grouped.get(role)!.push(smartFile);
  }

  // Sort within each group: finding count desc, then (additions + deletions) desc
  for (const group of grouped.values()) {
    group.sort((a, b) => {
      const findingDiff = b.finding_lines.length - a.finding_lines.length;
      if (findingDiff !== 0) return findingDiff;
      return (b.additions + b.deletions) - (a.additions + a.deletions);
    });
  }

  const groups: SmartDiffGroup[] = ROLE_ORDER.filter((r) => grouped.get(r)!.length > 0).map(
    (role) => ({ role, files: grouped.get(role)! }),
  );

  return {
    groups,
    split_suggestion: {
      too_big: totalLines > TOO_BIG_THRESHOLD,
      total_lines: totalLines,
      proposed_splits: [],
    },
  };
}
