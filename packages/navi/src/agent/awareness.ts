import z from "zod"
import path from "path"
import { Global } from "../global"
import { Provider } from "../provider/provider"

export namespace Awareness {
  export const Constraints = z.object({
    cost: z.enum(["low", "medium", "high", "any"]).default("any"),
    speed: z.enum(["fast", "medium", "slow", "any"]).default("any"),
    capabilities: z
      .object({
        image: z.boolean().optional(),
        toolcall: z.boolean().optional(),
        reasoning: z.boolean().optional(),
      })
      .optional(),
  })
  export type Constraints = z.infer<typeof Constraints>

  export type Recommendation = {
    model: Provider.Model
    score: number
    reasons: string[]
  }

  const AGENT_PROFILES: Record<string, Constraints> = {
    plan: { cost: "low", speed: "fast", capabilities: { reasoning: true, toolcall: true } },
    build: { cost: "high", speed: "medium", capabilities: { toolcall: true, reasoning: true } },
    vibemode: { cost: "high", speed: "medium", capabilities: { toolcall: true, reasoning: true } },
    specs: { cost: "high", speed: "medium", capabilities: { toolcall: true, reasoning: true } },
    "plan-ceo-review": { cost: "medium", speed: "fast", capabilities: { reasoning: true } },
    "plan-eng-review": { cost: "medium", speed: "fast", capabilities: { reasoning: true, toolcall: true } },
    ask: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    general: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    organizer: { cost: "medium", speed: "fast", capabilities: { reasoning: true } },
    researcher: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    autoresearch: { cost: "medium", speed: "medium", capabilities: { toolcall: true, reasoning: true } },
    explore: { cost: "low", speed: "fast", capabilities: { toolcall: true } },
    investigator: { cost: "low", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    browse: { cost: "low", speed: "fast", capabilities: { image: true, toolcall: true, reasoning: true } },
    debug: { cost: "medium", speed: "medium", capabilities: { toolcall: true, reasoning: true } },
    refactor: { cost: "medium", speed: "medium", capabilities: { toolcall: true, reasoning: true } },
    review: { cost: "medium", speed: "fast", capabilities: { reasoning: true } },
    critic: { cost: "medium", speed: "fast", capabilities: { reasoning: true } },
    "factual-verifier": { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    "regression-verifier": { cost: "low", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    "ui-verifier": { cost: "low", speed: "fast", capabilities: { image: true, toolcall: true, reasoning: true } },
    "security-verifier": { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    tester: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    qa: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    "qa-only": { cost: "low", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    frontend: { cost: "medium", speed: "fast", capabilities: { image: true, toolcall: true, reasoning: true } },
    multimodal: { cost: "medium", speed: "fast", capabilities: { image: true, reasoning: true } },
    documentation: { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    database: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    backend: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    devops: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    security: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    pentester: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    product: { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    support: { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    sales: { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    marketing: { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    social: { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    coach: { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    performance: { cost: "medium", speed: "fast", capabilities: { reasoning: true } },
    analyst: { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    automator: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    ship: { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } },
    travel: { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    "travel-agent": { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    "ux-researcher": { cost: "medium", speed: "fast", capabilities: { image: true, reasoning: true } },
    "visual-storyteller": { cost: "medium", speed: "fast", capabilities: { image: true, reasoning: true } },
    "lead-generator": { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    "content-creator": { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    "youtube-agent": { cost: "medium", speed: "fast", capabilities: { reasoning: true } },
    "real-estate": { cost: "low", speed: "fast", capabilities: { reasoning: true } },
    finance: { cost: "medium", speed: "fast", capabilities: { reasoning: true } },
    legal: { cost: "medium", speed: "slow", capabilities: { reasoning: true } },
    ralph: { cost: "high", speed: "medium", capabilities: { toolcall: true, reasoning: true } },
  }

  function toModelRef(model: Provider.Model): { providerID: string; modelID: string } {
    return { providerID: model.providerID, modelID: model.id }
  }

  function meetsConstraints(model: Provider.Model, constraints: Constraints) {
    if (constraints.capabilities?.image && !model.capabilities.input.image) return false
    if (constraints.capabilities?.toolcall && !model.capabilities.toolcall) return false
    if (constraints.capabilities?.reasoning && !model.capabilities.reasoning) return false
    return true
  }

  export function modelMatchesConstraints(model: Provider.Model, constraints: Constraints) {
    return meetsConstraints(model, constraints)
  }

  function scoreModel(model: Provider.Model, constraints: Constraints): Recommendation {
    let score = 0
    const reasons: string[] = []

    if (constraints.capabilities?.image) {
      if (model.capabilities.input.image) {
        score += 100
        reasons.push("supports image input")
      } else {
        score -= 1000
        reasons.push("missing image support")
      }
    }

    if (constraints.capabilities?.toolcall) {
      if (model.capabilities.toolcall) {
        score += 100
        reasons.push("supports tool calling")
      } else {
        score -= 1000
        reasons.push("missing tool calling")
      }
    }

    if (constraints.capabilities?.reasoning) {
      if (model.capabilities.reasoning) {
        score += 100
        reasons.push("supports reasoning")
      } else {
        score -= 1000
        reasons.push("missing reasoning")
      }
    }

    const inputCost = model.cost?.input ?? 0
    const outputCost = model.cost?.output ?? 0
    const averageCost = (inputCost + outputCost) / 2

    if (constraints.cost === "low") {
      score -= averageCost * 1000
      reasons.push("prefers lower cost")
    } else if (constraints.cost === "high") {
      score += averageCost * 1000
      reasons.push("prefers premium capability")
    }

    if (constraints.speed === "fast") {
      score -= averageCost * 500
      reasons.push("prefers fast turnaround")
    } else if (constraints.speed === "slow") {
      score += averageCost * 250
      reasons.push("accepts slower, deeper models")
    }

    if (model.limit?.context) {
      score += Math.min(model.limit.context / 1000, 100)
      reasons.push(`context window ${model.limit.context}`)
    }

    return { model, score, reasons }
  }

  export function profileForAgent(agentName: string): Constraints {
    return AGENT_PROFILES[agentName] ?? { cost: "medium", speed: "fast", capabilities: { toolcall: true, reasoning: true } }
  }

  export function availableModelsFromProviders(
    providers: Array<Pick<Provider.Info, "id" | "models">>,
  ) {
    const models: Provider.Model[] = []
    for (const provider of providers) {
      for (const model of Object.values(provider.models ?? {})) {
        models.push(model)
      }
    }
    return models
  }

  export function recommendModelsFromProviders(
    providers: Array<Pick<Provider.Info, "id" | "models">>,
    constraints: Constraints,
    limit = 5,
  ) {
    const models = availableModelsFromProviders(providers).filter((model) => model.status === "active")
    const filtered = models.filter((model) => meetsConstraints(model, constraints))
    const pool = filtered.length ? filtered : models
    return pool
      .map((model) => scoreModel(model, constraints))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  export async function availableModels() {
    const providers = await Provider.list()
    return availableModelsFromProviders(Object.values(providers))
  }

  export async function recommendModel(constraints: Constraints) {
    const recommendations = recommendModelsFromProviders(Object.values(await Provider.list()), constraints, 1)
    return recommendations[0]?.model
  }

  export function recommendModelForAgentFromProviders(
    providers: Array<Pick<Provider.Info, "id" | "models">>,
    agentName: string,
  ) {
    return recommendModelsFromProviders(providers, profileForAgent(agentName), 1)[0]?.model
  }

  export async function recommendModelForAgent(agentName: string) {
    return recommendModel(profileForAgent(agentName))
  }

  const VIBEMODE_ROLE_LABELS: Record<string, string> = {
    plan: "Planner",
    vibemode: "Loop Lead",
    review: "Gate Reviewer",
    critic: "Adjudicator",
    coding: "Implementation",
    frontend: "UI/UX",
    backend: "Backend",
    browse: "Browser Validation",
    qa: "QA",
    "qa-only": "Read-only QA",
    tester: "Testing",
    debug: "Debugging",
    researcher: "Research",
    autoresearch: "AutoResearch",
    explore: "Exploration",
    investigator: "Codebase Map",
    security: "Security",
    pentester: "Security Audit",
    "security-verifier": "Security Verification",
    "factual-verifier": "Fact Verification",
    "regression-verifier": "Regression Verification",
    "ui-verifier": "UI Verification",
    ship: "Release",
    organizer: "Coordination",
    general: "General",
  }

  export function buildVibemodeModelGuide(
    providers: Array<Pick<Provider.Info, "id" | "name" | "models">>,
  ) {
    const activeProviders = providers
      .map((provider) => ({
        provider,
        activeCount: Object.values(provider.models ?? {}).filter((model) => model.status === "active").length,
      }))
      .filter(({ activeCount }) => activeCount > 0)

    const sections: string[] = ["## Live model awareness"]

    if (activeProviders.length === 0) {
      sections.push("No active models are connected yet.")
      sections.push("Ask the user to connect a provider before choosing Loop Lead or Gate Reviewer models.")
      return sections.join("\n")
    }

    sections.push(
      "Active providers: " +
        activeProviders
          .map(({ provider, activeCount }) => `${provider.name ?? provider.id} (${activeCount} active)`)
          .join(", "),
    )
    sections.push("")
    sections.push("Recommended role assignments:")

    const roles = [
      "plan",
      "vibemode",
      "review",
      "critic",
      "coding",
      "frontend",
      "backend",
      "browse",
      "qa",
      "qa-only",
      "tester",
      "debug",
      "researcher",
      "autoresearch",
      "explore",
      "factual-verifier",
      "regression-verifier",
      "ui-verifier",
      "security-verifier",
      "security",
      "ship",
      "organizer",
      "general",
    ]
    for (const role of roles) {
      const recommendations = recommendModelsFromProviders(providers, profileForAgent(role), 2)
      if (recommendations.length === 0) continue

      const label = VIBEMODE_ROLE_LABELS[role] ?? role
      const lines = recommendations.map((recommendation, index) => {
        const model = recommendation.model
        const prefix = index === 0 ? "-" : "  - backup:"
        const reasons = recommendation.reasons.slice(0, 2).join(", ")
        return `${prefix} ${label}: ${model.providerID}/${model.id}${reasons ? ` (${reasons})` : ""}`
      })
      sections.push(...lines)
    }

    sections.push("")
    sections.push(
      "Use the Loop Lead recommendation for `vibemode` and the Gate Reviewer recommendation for `review` unless the user overrides them.",
    )

    return sections.join("\n")
  }

  export async function status() {
    const models = await availableModels()
    const active = models.filter((model) => model.status === "active")

    const byProvider: Record<string, string[]> = {}
    for (const model of active) {
      if (!byProvider[model.providerID]) byProvider[model.providerID] = []
      byProvider[model.providerID].push(model.id)
    }

    let favorites: string[] = []
    try {
      const file = Bun.file(path.join(Global.Path.state, "model.json"))
      const data = await file.json()
      if (Array.isArray(data.favorite)) {
        favorites = data.favorite.map((x: any) => `${x.providerID}/${x.modelID}`)
      }
    } catch {
      // Ignore missing or malformed model store state.
    }

    return {
      total: models.length,
      active: active.length,
      providers: byProvider,
      favorites,
    }
  }
}
