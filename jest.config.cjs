/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Coverage gate for the CLI library (issue #40). The generated types
  // file is excluded — it's regenerated from the schema and the schema
  // itself is the contract under test. Applies when running with
  // `--coverage` (i.e. `pnpm test:coverage`); the default `pnpm test`
  // skips collection for speed.
  collectCoverageFrom: [
    'src/cli/lib/**/*.ts',
    '!src/cli/lib/generated-types.ts',
  ],
  // Aggregate threshold across the collected paths (src/cli/lib only —
  // see collectCoverageFrom above). Per-file thresholds would be too
  // strict: `ollama-analyzer.ts` has untested branches that hit the
  // network and `selector-checker.ts` has rare error paths. The
  // aggregate keeps the bar honest without forcing brittle mocks.
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
    },
  },
};