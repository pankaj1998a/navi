import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { Keybind } from "@/util/keybind"
import { ProviderHealth } from "@/provider/health"
import * as fuzzysort from "fuzzysort"

export function useConnected() {
  const sync = useSync()
  return createMemo(() =>
    sync.data.provider.some((x) => x.id !== "navi" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
}

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

function formatCapabilityHints(model: { capabilities?: { reasoning?: boolean; toolcall?: boolean; input?: { image?: boolean; pdf?: boolean } }; limit?: { context?: number } }) {
  const hints: string[] = []
  if (model.capabilities?.reasoning) hints.push("reasoning")
  if (model.capabilities?.toolcall) hints.push("toolcall")
  if (model.capabilities?.input?.image) hints.push("image")
  if (model.capabilities?.input?.pdf) hints.push("pdf")
  if (model.limit?.context) hints.push(`${Math.round(model.limit.context / 1000)}k ctx`)
  return hints.join(" · ")
}

function formatModelCost(model: { cost?: { input: number; output: number; cache?: { read: number; write: number } } }) {
  const cost = model.cost
  if (!cost) return "cost unknown"
  if (cost.input === 0 && cost.output === 0 && (cost.cache?.read ?? 0) === 0 && (cost.cache?.write ?? 0) === 0) {
    return "free"
  }
  const parts = [`in ${cost.input.toFixed(4)}`, `out ${cost.output.toFixed(4)}`]
  if (cost.cache && (cost.cache.read || cost.cache.write)) {
    parts.push(`cache ${cost.cache.read.toFixed(4)}/${cost.cache.write.toFixed(4)}`)
  }
  return parts.join(" · ")
}

function formatContextLimit(limit?: number) {
  if (!limit) return "context unknown"
  return `${limit.toLocaleString()} ctx`
}

export function DialogModel(props: { providerID?: string; agentName?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [ref, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => {
    if (!connected()) return false
    if (props.providerID) return false
    return true
  })

  const options = createMemo(() => {
    const q = query()
    const needle = q.trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    const recentList = showSections
      ? recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      )
      : []

    const favoriteOptions = showSections
      ? favorites.flatMap((item) => {
        const provider = sync.data.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        const health = ProviderHealth.summarizeProvider(provider)
        return [
          {
            key: item,
            value: {
              providerID: provider.id,
              modelID: model.id,
            },
            title: model.name ?? item.modelID,
            description: `${provider.name} · ${health.status} · ${health.activeModels} active · ${model.status}`,
            category: "Favorites",
            disabled: provider.id === "navi" && model.id.includes("-nano"),
            footer: [
              formatCapabilityHints(model),
              formatModelCost(model),
              formatContextLimit(model.limit?.context),
              provider.catalog?.ageMs !== undefined ? formatCatalogAge(provider.catalog.ageMs) : undefined,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
            onSelect: () => {
              dialog.clear()
              local.model.set(
                {
                  providerID: provider.id,
                  modelID: model.id,
                },
                { recent: true, agentName: props.agentName },
              )
            },
          },
        ]
      })
      : []

    const recentOptions = showSections
      ? recentList.flatMap((item) => {
        const provider = sync.data.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        const health = ProviderHealth.summarizeProvider(provider)
        return [
          {
            key: item,
            value: {
              providerID: provider.id,
              modelID: model.id,
            },
            title: model.name ?? item.modelID,
            description: `${provider.name} · ${health.status} · ${health.activeModels} active · ${model.status}`,
            category: "Recent",
            disabled: provider.id === "navi" && model.id.includes("-nano"),
            footer: [
              formatCapabilityHints(model),
              formatModelCost(model),
              formatContextLimit(model.limit?.context),
              provider.catalog?.ageMs !== undefined ? formatCatalogAge(provider.catalog.ageMs) : undefined,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
            onSelect: () => {
              dialog.clear()
              local.model.set(
                {
                  providerID: provider.id,
                  modelID: model.id,
                },
                { recent: true, agentName: props.agentName },
              )
            },
          },
        ]
      })
      : []

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "navi",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          // filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => {
            const health = ProviderHealth.summarizeProvider(provider)
            const value = {
              providerID: provider.id,
              modelID: model,
            }
            const isFavorite = favorites.some(
              (item) => item.providerID === value.providerID && item.modelID === value.modelID,
            )
            const footer = [
              formatCapabilityHints(info),
              isFavorite ? "(Favorite)" : undefined,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
            return {
              value,
              title: info.name ?? model,
              description: `${provider.name} · ${health.status} · ${health.activeModels} active${
                provider.catalog?.ageMs !== undefined ? ` · ${formatCatalogAge(provider.catalog.ageMs)}` : ""
              } · ${info.status}`,
              footer: [footer, formatModelCost(info), formatContextLimit(info.limit?.context)]
                .filter(Boolean)
                .join(" · "),
              category: connected() ? provider.name : undefined,
              disabled: false,
              onSelect() {
                dialog.clear()
                local.model.set(
                  {
                    providerID: provider.id,
                    modelID: model,
                  },
                  { recent: true, agentName: props.agentName },
                )
              },
            }
          }),
          filter((x) => {
            if (!showSections) return true
            const value = x.value
            const inFavorites = favorites.some(
              (item) => item.providerID === value.providerID && item.modelID === value.modelID,
            )
            if (inFavorites) return false
            const inRecents = recentList.some(
              (item) => item.providerID === value.providerID && item.modelID === value.modelID,
            )
            if (inRecents) return false
            return true
          }),
      sortBy(
            (x) => x.footer?.includes("Free") !== true,
            (x) => x.title,
          ),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
        providers(),
        map((option) => {
          const provider = sync.data.provider.find((provider) => provider.id === option.value)
          const age = provider?.catalog?.ageMs !== undefined ? formatCatalogAge(provider.catalog.ageMs) : undefined
          return {
            ...option,
            description: [
              option.description,
              age,
            ]
              .filter(Boolean)
              .join(" · "),
            category: "Popular providers",
          }
        }),
        take(6),
      )
      : []

    // Search shows a single merged list (favorites inline)
    if (needle) {
      const filteredProviders = fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj)
      const filteredPopular = fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj)
      return [...filteredProviders, ...filteredPopular]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    if (props.agentName) return `Select model for ${props.agentName}`
    if (provider()) return provider()!.name
    return "Select model"
  })

  return (
    <DialogSelect
      keybind={[
        {
          keybind: Keybind.parse("ctrl+a")[0],
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: Keybind.parse("ctrl+f")[0],
          title: "Favorite",
          disabled: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      ref={setRef}
      onFilter={setQuery}
      skipFilter={true}
      title={title()}
      current={props.agentName ? local.model.getForAgent(props.agentName) : local.model.current()}
      options={options()}
    />
  )
}
