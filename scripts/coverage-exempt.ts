/**
 * Heavy suites the coverage aggregate runs uninstrumented in a parallel gate.
 * Borrowed from deepseek-harness/scripts/coverage-exempt.ts - simplified for navi.
 * Membership rule: a suite qualifies only when every coverage-measured file it
 * executes in-process is already fully covered by other suites, so removing it
 * from the instrumented run changes no threshold outcome.
 */

export interface CoverageExemptSuite {
  /** Positional file filter selecting the suite in the uninstrumented gate. */
  readonly filter: string
  /** Exclude glob removing the suite from the instrumented gate. */
  readonly exclude: string
}

/**
 * Set to `1` by the instrumented coverage gate; vitest.config.ts then drops
 * the exempt suites from every project.
 */
export const COVERAGE_EXEMPT_ENV = 'NAVI_COVERAGE_EXEMPT_HEAVY'

/** Coverage-exempt heavy suites; keep filter and exclude selecting the same files. */
export const coverageExemptHeavySuites: readonly CoverageExemptSuite[] = [
  // Example heavy suites - adapt as navi grows.
  // Keeping empty initially; add entries like:
  // { filter: 'packages/heavy-package/tests/', exclude: 'packages/heavy-package/tests/**' },
]
