import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderHealth } from "../../provider/health"
import { Awareness } from "../../agent/awareness"
import { Auth } from "../../auth"
import { ProviderDiagnostics } from "../../provider/diagnostics"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"

function formatCatalogAge(ageMs?: number) {
  if (ageMs === undefined) return "freshness unknown"
  const seconds = Math.floor(ageMs / 1000)
  if (seconds < 60) return `${seconds}s old`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m old`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h old`
  return `${Math.floor(hours / 24)}d old`
}

function formatModelCost(model: { cost?: { input: number; output: number; cache: { read: number; write: number } } }) {
  const cost = model.cost
  if (!cost) return "cost unknown"
  const parts: string[] = []
  if (cost.input === 0 && cost.output === 0 && cost.cache.read === 0 && cost.cache.write === 0) {
    parts.push("free")
  } else {
    parts.push(`in ${cost.input.toFixed(4)}`)
    parts.push(`out ${cost.output.toFixed(4)}`)
    if (cost.cache.read || cost.cache.write) {
      parts.push(`cache ${cost.cache.read.toFixed(4)}/${cost.cache.write.toFixed(4)}`)
    }
  }
  return parts.join(" · ")
}

function formatContextLimit(limit?: number) {
  if (!limit) return "context unknown"
  return `${limit.toLocaleString()} ctx`
}

function formatAgeMs(ageMs?: number) {
  if (ageMs === undefined) return "unknown"
  if (ageMs < 1000) return `${ageMs}ms`
  const seconds = Math.floor(ageMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function getLatestActiveModel(provider: { models?: Record<string, { release_date: string; status: string }> }) {
  return Object.values(provider.models ?? {})
    .filter((model) => model.status === "active")
    .sort((a, b) => new Date(b.release_date).getTime() - new Date(a.release_date).getTime())[0]
}

export const ModelsCommand = cmd({
  command: "models [provider]",
  describe: "list all available models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      })
      .option("recommend-for", {
        describe: "show model recommendations for a specific agent or mode",
        type: "string",
      })
      .option("latest", {
        describe: "show the latest active model for each provider",
        type: "boolean",
      })
      .option("recommended", {
        describe: "show recommended models for common Navi modes",
        type: "boolean",
      })
      .option("status", {
        describe: "show provider health, auth status, and catalog freshness",
        type: "boolean",
      })
  },
  handler: async (args) => {
    if (args.refresh) {
      await ModelsDev.refresh(true)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
    }

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const providers = await Provider.list()
        const selectedProviders = args.provider ? (providers[args.provider] ? [providers[args.provider]] : []) : Object.values(providers)

        if (args.status) {
          const catalogDiagnostics = await ProviderDiagnostics.summarize({ scope: "models-dev" }).catch(() => undefined)
          if (catalogDiagnostics) {
            UI.println(
              UI.Style.TEXT_HIGHLIGHT_BOLD + `# models.dev` + UI.Style.TEXT_NORMAL,
              `refresh=${catalogDiagnostics.lastStatus ?? "unknown"}:${catalogDiagnostics.refreshCount}`,
              `last=${catalogDiagnostics.lastRefreshedAt ? new Date(catalogDiagnostics.lastRefreshedAt).toISOString() : "unknown"}`,
            )
            if (catalogDiagnostics.lastError) {
              UI.println(UI.Style.TEXT_DIM + `  last-error=${catalogDiagnostics.lastError}` + UI.Style.TEXT_NORMAL)
            }
          }
        }

        if (args.recommended) {
          const commonModes = ["ask", "build", "debug", "researcher", "review", "qa", "vibemode", "browse"]
          for (const mode of commonModes) {
            const recommendations = Awareness.recommendModelsFromProviders(
              selectedProviders,
              Awareness.profileForAgent(mode),
              1,
            )
            const top = recommendations[0]
            if (!top) continue
            const model = top.model
            UI.println(`Recommended for ${mode}: ${model.providerID}/${model.id} (${Math.round(top.score)})`)
            if (args.verbose) {
              UI.println(`  ${top.reasons.join(", ")}`)
            }
          }
          return
        }

        if (args.latest) {
          const providerIDs = args.provider ? [args.provider] : Object.keys(providers).sort((a, b) => a.localeCompare(b))
          for (const providerID of providerIDs) {
            const provider = providers[providerID]
            if (!provider) continue
            if (args.status) {
              await printProviderStatus(providerID)
            }
            const latest = getLatestActiveModel(provider)
            if (!latest) {
              UI.println(`# ${providerID}`)
              UI.println("  No active models found")
              continue
            }
            UI.println(`# ${providerID}`)
            UI.println(`  latest=${latest.id}`)
            UI.println(`  ${formatModelCost(latest)} · ${formatContextLimit(latest.limit?.context)}`)
            if (args.verbose) {
              UI.println(`  release=${latest.release_date}`)
            }
          }
          return
        }

        if (args.recommendFor) {
          const recommendations = Awareness.recommendModelsFromProviders(
            selectedProviders,
            Awareness.profileForAgent(args.recommendFor),
            5,
          )
          if (recommendations.length === 0) {
            UI.println(`No active models found for ${args.recommendFor}`)
          } else {
            UI.println(`Recommended models for ${args.recommendFor}`)
            for (const recommendation of recommendations) {
              const model = recommendation.model
              UI.println(`- ${model.providerID}/${model.id} (${Math.round(recommendation.score)})`)
              if (args.verbose) {
                UI.println(`  ${recommendation.reasons.join(", ")}`)
              }
            }
            UI.println("")
          }
        }

        async function printProviderStatus(providerID: string) {
          const provider = providers[providerID]
          if (!provider) return
          const health = ProviderHealth.summarizeProvider(provider)
          const auth = await Auth.get(providerID).catch(() => undefined)
          const diagnostics = await ProviderDiagnostics.summarize({ scope: "provider-refresh", providerID }).catch(() => undefined)
          const activeModels = Object.values(provider.models ?? {}).filter((model) => model.status === "active").length
          const authStatus =
            provider.source === "config" && !auth
              ? "configured"
              : auth
                ? "connected"
                : provider.source === "free"
                  ? "free"
                  : provider.source

          UI.println(
            UI.Style.TEXT_HIGHLIGHT_BOLD + `# ${providerID}` + UI.Style.TEXT_NORMAL,
            `health=${health.status}:${health.score}`,
            `auth=${authStatus}`,
            `active=${activeModels}`,
            `refresh=${diagnostics?.lastStatus ?? "unknown"}:${diagnostics?.refreshCount ?? 0}`,
          )
          UI.println(
            UI.Style.TEXT_DIM +
            `  capabilities toolcall=${health.capabilities.toolcall.score} reasoning=${health.capabilities.reasoning.score} image=${health.capabilities.image.score} multimodal=${health.capabilities.multimodal.score} structured=${health.capabilities.structuredOutput.score}` +
            UI.Style.TEXT_NORMAL,
          )
          if (diagnostics?.lastRefreshedAt) {
            UI.println(
              UI.Style.TEXT_DIM +
              `  refreshed=${new Date(diagnostics.lastRefreshedAt).toISOString()} (${formatAgeMs(Date.now() - diagnostics.lastRefreshedAt)} ago)` +
              UI.Style.TEXT_NORMAL,
            )
          }
          if (diagnostics?.lastError) {
            UI.println(UI.Style.TEXT_DIM + `  last-error=${diagnostics.lastError}` + UI.Style.TEXT_NORMAL)
          }
          UI.println(
            UI.Style.TEXT_DIM +
            `  catalog=${provider.catalog?.source ?? "unknown"} (${formatCatalogAge(provider.catalog?.ageMs)}) fetched=${provider.catalog?.fetchedAt ?? "unknown"}` +
            UI.Style.TEXT_NORMAL,
          )
          if (args.recommendFor) {
            const top = Awareness.recommendModelsFromProviders(
              [provider],
              Awareness.profileForAgent(args.recommendFor),
              1,
            )[0]
            if (top) {
              UI.println(
                UI.Style.TEXT_DIM +
                `  best-for-${args.recommendFor}=${top.model.id} (${Math.round(top.score)})` +
                UI.Style.TEXT_NORMAL,
              )
            }
          }
        }

        async function printModels(providerID: string, verbose?: boolean, showStatus?: boolean) {
          const provider = providers[providerID]
          if (!provider) return
          if (showStatus) {
            await printProviderStatus(providerID)
          }
          if (verbose && provider.catalog) {
            process.stdout.write(`# catalog: ${provider.catalog.source} @ ${provider.catalog.fetchedAt}`)
            if (provider.catalog.ageMs !== undefined) {
              process.stdout.write(` (${Math.floor(provider.catalog.ageMs / 1000)}s old)`)
            }
            process.stdout.write(EOL)
          }
          const sortedModels = Object.entries(provider.models ?? {}).sort(([a], [b]) => a.localeCompare(b))
          for (const [modelID, model] of sortedModels) {
            process.stdout.write(`${providerID}/${modelID}`)
            process.stdout.write(EOL)
            if (verbose) {
              process.stdout.write(JSON.stringify(model, null, 2))
              process.stdout.write(EOL)
            }
          }
        }

        if (args.provider) {
          const provider = providers[args.provider]
          if (!provider) {
            UI.error(`Provider not found: ${args.provider}`)
            return
          }

          await printModels(args.provider, args.verbose, args.status || !!args.recommendFor)
          return
        }

        const providerIDs = Object.keys(providers).sort((a, b) => {
          const aIsnavi = a.startsWith("navi")
          const bIsnavi = b.startsWith("navi")
          if (aIsnavi && !bIsnavi) return -1
          if (!aIsnavi && bIsnavi) return 1
          return a.localeCompare(b)
        })

        for (const providerID of providerIDs) {
          await printModels(providerID, args.verbose, args.status || !!args.recommendFor)
        }
      },
    })
  },
})
