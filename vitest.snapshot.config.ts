import { availableParallelism } from 'node:os'
import { defineConfig } from 'vitest/config'

const DEFAULT_SNAPSHOT_MAX_CONCURRENCY = 5

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return value
}

const snapshotMaxConcurrency = positiveIntFromEnv(
  'NAVI_SNAPSHOT_MAX_CONCURRENCY',
  Math.min(DEFAULT_SNAPSHOT_MAX_CONCURRENCY, availableParallelism()),
)

if (process.env.NAVI_SNAPSHOT === 'record') {
  try {
    process.loadEnvFile(new URL('.env', import.meta.url).pathname)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
  }
}

export default defineConfig({
  test: {
    include: [
      'scripts/**/*.snapshot.ts',
      'packages/*/tests/**/*.snapshot.ts',
      'packages/*/*/tests/**/*.snapshot.ts',
    ],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    fileParallelism: (process.env.NAVI_SNAPSHOT || 'replay') === 'replay' && snapshotMaxConcurrency > 1,
    maxConcurrency: snapshotMaxConcurrency,
  },
})
