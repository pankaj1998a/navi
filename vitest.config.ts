import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Prints exact `path:line:col` records for every uncovered statement, branch
// path, and function when a file misses the per-file 100% gate - the built-in
// threshold ERRORs name only the file. Absolute path because istanbul-reports
// require()s custom reporters (which is also why the reporter is CJS).
// Borrowed from deepseek-harness uncoveredLocationsReporter concept (simple adapt: use v8/vitum).
const uncoveredLocationsReporter = fileURLToPath(
  new URL('./scripts/coverage-uncovered-locations.cjs', import.meta.url),
)

export default defineConfig({
  test: {
    // Canonical runner is `bun test` from `packages/navi` (see
    // `packages/navi/package.json` `test` / `test:ci`, guard
    // `do-not-run-tests-from-root` in `bunfig.toml`). This vitest config
    // exists only for `bunx vitest run --coverage` ratchet runs.
    include: [
      'packages/*/test/**/*.spec.{ts,tsx}',
      'packages/*/*/test/**/*.spec.{ts,tsx}',
      'packages/*/test/**/*.test.{ts,tsx}',
      'packages/*/*/test/**/*.test.{ts,tsx}',
      // Legacy plural layout (kept for compat if reintroduced).
      'packages/*/tests/**/*.spec.{ts,tsx}',
      'packages/*/*/tests/**/*.spec.{ts,tsx}',
      'packages/*/tests/**/*.test.{ts,tsx}',
      'scripts/**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.sst/**'],
    coverage: {
      provider: 'istanbul',
      // Coverage measures packages runtime source.
      include: ['packages/*/src/**/*.{ts,tsx}', 'packages/*/*/src/**/*.{ts,tsx}'],
      exclude: [
        'packages/*/src/types.ts',
        'packages/*/src/bin.ts',
        'packages/*/src/worker.ts',
        '**/*.d.ts',
        '**/node_modules/**',
      ],
      // Ratchet gate: 70% per-file floor. Raise by ~5pts once green for a
      // week; do not jump straight to 100% (dead gate - v8 provider never
      // reaches it and the custom uncovered-locations reporter only works
      // with the istanbul provider). Canonical check is still
      // `bun test --coverage` from `packages/navi`.
      // coverage 70% per-file ratchet gate
      thresholds: {
        perFile: true,
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
      // snapshot reporter + uncovered locations reporter
      reporter: process.env.CI
        ? ['text', uncoveredLocationsReporter]
        : ['text', 'html', uncoveredLocationsReporter],
    },
  },
})
