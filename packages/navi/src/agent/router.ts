import { Config } from "@/config/config"
import { Awareness } from "./awareness"
import { Provider } from "@/provider/provider"
import { ProviderHealth } from "@/provider/health"
import { ProviderReliability } from "@/provider/reliability"
import { AgentPolicy } from "./policy"
import { ModelID, ProviderID } from "@/provider/schema"

export namespace AgentRouter {
  export type Decision = {
    model: Provider.Model
    changed: boolean
    reasons: string[]
  }

  export function chooseFromProviders(input: {
    providers: Array<Pick<Provider.Info, "id" | "source" | "models">>
    requested: Provider.Model
    agentName: string
    allowFallback?: boolean
    minHealthScore?: number
    crossProvider?: boolean
    reliability?: Array<ProviderReliability.Summary>
  }): Decision {
    const reasons: string[] = []
    const constraints = Awareness.profileForAgent(input.agentName)
    const requestedProvider = input.providers.find((provider) => provider.id === input.requested.providerID)
    const requestedHealth = requestedProvider ? ProviderHealth.summarizeProvider(requestedProvider).score : 0
    const reliability = input.reliability ?? []
    const minHealthScore = input.minHealthScore ?? 45
    const allowFallback = input.allowFallback !== false
    const requestedReliability =
      reliability.find(
        (item) => item.providerID === input.requested.providerID && item.modelID === input.requested.id,
      )?.score ?? 50

    const requestedFits = Awareness.modelMatchesConstraints(input.requested, constraints)
    if (requestedFits) reasons.push("requested model fits agent constraints")
    else reasons.push("requested model is missing preferred capabilities")

    if (requestedFits && requestedHealth >= minHealthScore && requestedReliability >= 40) {
      reasons.push(`requested provider health ${requestedHealth}`)
      reasons.push(`requested model reliability ${Math.round(requestedReliability)}`)
      const requestedProviderCapability = requestedProvider ? ProviderHealth.summarizeProvider(requestedProvider).capabilities : undefined
      if (requestedProviderCapability) {
        reasons.push(
          `provider capability toolcall=${requestedProviderCapability.toolcall.score} reasoning=${requestedProviderCapability.reasoning.score} image=${requestedProviderCapability.image.score}`,
        )
      }
      return {
        model: input.requested,
        changed: false,
        reasons,
      }
    }

    if (!allowFallback) {
      reasons.push("fallback routing disabled")
      return {
        model: input.requested,
        changed: false,
        reasons,
      }
    }

    const healthyProviders = input.providers.filter((provider) => ProviderHealth.summarizeProvider(provider).score >= minHealthScore)
    const providerPool = healthyProviders.length ? healthyProviders : input.providers
    const recommendationPool =
      input.crossProvider === false
        ? providerPool.filter((provider) => provider.id === input.requested.providerID)
        : providerPool

    const recommendations = Awareness.recommendModelsFromProviders(
      recommendationPool.length ? recommendationPool : providerPool,
      constraints,
      50,
    )
    const scored = recommendations
      .map((item) => {
        const provider = input.providers.find((provider) => provider.id === item.model.providerID)
        const health = provider ? ProviderHealth.summarizeProvider(provider) : undefined
        const reliabilitySummary = reliability.find(
          (entry) => entry.providerID === item.model.providerID && entry.modelID === item.model.id,
        )
        const reliabilityScore = reliabilitySummary?.score ?? 50
        const costPenalty = reliabilitySummary?.avgCost ? Math.min(reliabilitySummary.avgCost * 1000, 10) : 0
        const capabilityBonus = health
          ? [
              constraints.capabilities?.toolcall ? health.capabilities.toolcall.score : 0,
              constraints.capabilities?.reasoning ? health.capabilities.reasoning.score : 0,
              constraints.capabilities?.image ? health.capabilities.image.score : 0,
            ].reduce((sum, value) => sum + value, 0) / 3
          : 0
        const routingScore = item.score + (health?.score ?? 0) + reliabilityScore + capabilityBonus - costPenalty
        const routingReasons = [...item.reasons]
        if (health) routingReasons.push(`provider health ${health.score}`)
        if (health) {
          routingReasons.push(
            `capabilities toolcall=${health.capabilities.toolcall.score} reasoning=${health.capabilities.reasoning.score} image=${health.capabilities.image.score}`,
          )
        }
        if (reliabilitySummary) {
          routingReasons.push(
            `reliability ${Math.round(reliabilitySummary.score)} (${Math.round(reliabilitySummary.successRate * 100)}% success, $${reliabilitySummary.avgCost.toFixed(4)} avg cost)`,
          )
        }
        return {
          ...item,
          routingScore,
          routingReasons,
        }
      })
      .sort((a, b) => b.routingScore - a.routingScore)

    const chosen = scored.find(
      (item) => item.model.id !== input.requested.id || item.model.providerID !== input.requested.providerID,
    )

    if (!chosen) {
      reasons.push("no better model candidate found")
      return {
        model: input.requested,
        changed: false,
        reasons,
      }
    }

    reasons.push(`routed to ${chosen.model.providerID}/${chosen.model.id}`)
    reasons.push(...chosen.routingReasons.slice(0, 3))
    return {
      model: chosen.model,
      changed: chosen.model.id !== input.requested.id || chosen.model.providerID !== input.requested.providerID,
      reasons,
    }
  }

  export async function route(input: {
    agent: { name: string; model?: { providerID: string; modelID: string }; executionPolicy?: AgentPolicy.Info }
    requested: Provider.Model
  }): Promise<Decision> {
    if (input.agent.model) {
      const exact = await Provider.getModel(
        ProviderID.make(input.agent.model.providerID), 
        ModelID.make(input.agent.model.modelID)
      )
      return {
        model: exact,
        changed: exact.providerID !== input.requested.providerID || exact.id !== input.requested.id,
        reasons: ["using agent-specific model override"],
      }
    }

    const config = await Config.get()
    const routing = config.experimental?.modelRouting
    if (routing?.enabled === false) {
      return {
        model: input.requested,
        changed: false,
        reasons: ["model routing disabled"],
      }
    }

    return chooseFromProviders({
      providers: Object.values(await Provider.list()),
      requested: input.requested,
      agentName: input.agent.name,
      allowFallback: routing?.allowFallback,
      minHealthScore: routing?.minHealthScore,
      crossProvider: routing?.crossProvider,
      reliability: await ProviderReliability.list(),
    })
  }
}


