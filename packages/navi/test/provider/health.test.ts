import { expect, test } from "bun:test"
import { ProviderHealth } from "../../src/provider/health"

test("provider health penalizes stale unauthenticated providers", () => {
  const stale = ProviderHealth.summarizeProvider({
    id: "config-only",
    source: "config",
    catalog: {
      source: "cache",
      fetchedAt: new Date(0).toISOString(),
      ageMs: 40 * 24 * 60 * 60 * 1000,
    },
    models: {},
  } as any)

  const healthy = ProviderHealth.summarizeProvider({
    id: "api-live",
    source: "api",
    catalog: {
      source: "cache",
      fetchedAt: new Date().toISOString(),
      ageMs: 1000,
    },
    models: {
      "model-a": { status: "active" },
    },
  } as any)

  expect(stale.score).toBeLessThan(healthy.score)
  expect(stale.status).toBe("unavailable")
  expect(healthy.status).toBe("healthy")
})
