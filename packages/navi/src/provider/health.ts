import z from "zod"
import { Provider } from "./provider"

export namespace ProviderHealth {
  export const CapabilitySummary = z
    .object({
      score: z.number().min(0).max(100),
      supportedModels: z.number().int().nonnegative(),
      totalModels: z.number().int().nonnegative(),
    })
    .meta({ ref: "ProviderCapabilitySummary" })

  export const ContextSummary = z
    .object({
      max: z.number().nonnegative(),
      average: z.number().nonnegative(),
    })
    .meta({ ref: "ProviderContextSummary" })

  export const Capabilities = z
    .object({
      toolcall: CapabilitySummary,
      reasoning: CapabilitySummary,
      image: CapabilitySummary,
      multimodal: CapabilitySummary,
      structuredOutput: CapabilitySummary,
      context: ContextSummary,
    })
    .meta({ ref: "ProviderCapabilities" })

  export const Summary = z
    .object({
      providerID: z.string(),
      score: z.number().min(0).max(100),
      status: z.enum(["healthy", "degraded", "unavailable"]),
      reasons: z.array(z.string()),
      activeModels: z.number().int().nonnegative(),
      capabilities: Capabilities,
    })
    .meta({
      ref: "ProviderHealthSummary",
    })
  export type Summary = z.infer<typeof Summary>

  export function summarizeProvider(provider: Pick<Provider.Info, "id" | "source" | "models" | "catalog">): Summary {
    const reasons: string[] = []
    const active = Object.values(provider.models ?? {}).filter((model) => model.status === "active")
    const activeModels = active.length
    let score = 100

    if (activeModels === 0) {
      score -= 80
      reasons.push("no active models")
    } else {
      reasons.push(`${activeModels} active models`)
    }

    if (provider.source === "free") {
      score -= 10
      reasons.push("using free-access provider path")
    }

    if (provider.source === "config") {
      score -= 15
      reasons.push("configured but not authenticated")
    }

    const ageMs = provider.catalog?.ageMs ?? 0
    if (ageMs > 0) {
      const days = Math.floor(ageMs / (24 * 60 * 60 * 1000))
      if (days >= 30) {
        score -= 30
        reasons.push(`model catalog is stale (${days}d old)`)
      } else if (days >= 7) {
        score -= 15
        reasons.push(`model catalog is aging (${days}d old)`)
      }
    }

    if (!provider.catalog) {
      score -= 10
      reasons.push("missing catalog metadata")
    }

    const capabilityStats = summarizeCapabilities(active)
    score += Math.round(
      (capabilityStats.toolcall.score +
        capabilityStats.reasoning.score +
        capabilityStats.image.score +
        capabilityStats.multimodal.score +
        capabilityStats.structuredOutput.score) /
        10,
    )
    score = Math.max(0, Math.min(100, score))
    const status = score >= 75 ? "healthy" : score >= 40 ? "degraded" : "unavailable"

    return {
      providerID: provider.id,
      score,
      status,
      reasons,
      activeModels,
      capabilities: capabilityStats,
    }
  }

  export function summarizeProviders(providers: Array<Pick<Provider.Info, "id" | "source" | "models" | "catalog">>) {
    return providers.map(summarizeProvider).sort((a, b) => b.score - a.score)
  }

  export async function list() {
    return summarizeProviders(Object.values(await Provider.list()))
  }

  function summarizeCapabilities(models: Array<Provider.Model>) {
    const totalModels = models.length
    const scoreFor = (supported: number) => (totalModels ? Math.round((supported / totalModels) * 100) : 0)
    const countToolcall = models.filter((model) => model.capabilities.toolcall).length
    const countReasoning = models.filter((model) => model.capabilities.reasoning).length
    const countImage = models.filter(
      (model) => model.capabilities.input.image || model.capabilities.output.image,
    ).length
    const countMultimodal = models.filter((model) => {
      const input = model.capabilities.input
      const output = model.capabilities.output
      return (
        input.image ||
        input.audio ||
        input.video ||
        input.pdf ||
        output.image ||
        output.audio ||
        output.video ||
        output.pdf
      )
    }).length
    const countStructured = models.filter((model) => model.capabilities.toolcall && model.capabilities.reasoning).length
    const contextValues = models.map((model) => model.limit?.context ?? 0).filter((value) => value > 0)
    return {
      toolcall: {
        score: scoreFor(countToolcall),
        supportedModels: countToolcall,
        totalModels,
      },
      reasoning: {
        score: scoreFor(countReasoning),
        supportedModels: countReasoning,
        totalModels,
      },
      image: {
        score: scoreFor(countImage),
        supportedModels: countImage,
        totalModels,
      },
      multimodal: {
        score: scoreFor(countMultimodal),
        supportedModels: countMultimodal,
        totalModels,
      },
      structuredOutput: {
        score: scoreFor(countStructured),
        supportedModels: countStructured,
        totalModels,
      },
      context: {
        max: contextValues.length ? Math.max(...contextValues) : 0,
        average: contextValues.length ? contextValues.reduce((sum, value) => sum + value, 0) / contextValues.length : 0,
      },
    }
  }
}
