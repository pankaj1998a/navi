import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"

export function DialogModel(props: { providerID?: string; agent?: string }) {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => connected() && !props.providerID)

  const options = createMemo(() => {
    // ... same options logic ...
    // (keeping original logic for now)
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            title: model.name ?? item.modelID,
            description: provider.name,
            category,
            disabled: provider.id === "navi" && model.id.includes("-nano"),
            footer: model.cost?.input === 0 && provider.id === "navi" ? "Free" : undefined,
            onSelect: () => {
              onSelect(provider.id, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

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
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: info.name ?? model,
            description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
              ? "(Favorite)"
              : undefined,
            category: connected() ? provider.name : undefined,
            disabled: provider.id === "navi" && model.includes("-nano"),
            footer: info.cost?.input === 0 && provider.id === "navi" ? "Free" : undefined,
            onSelect() {
              onSelect(provider.id, model)
            },
          })),
          filter((x) => {
            if (!showSections) return true
            if (favorites.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
            if (recents.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
            return true
          }),
          sortBy(
            (x) => x.footer !== "Free",
            (x) => x.title,
          ),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "Popular providers",
          })),
          take(6),
        )
      : []

    if (needle) {
      return [
        ...fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    const value = provider()
    if (!value) return props.agent ? `Select model for ${props.agent}` : "Select model"
    return value.name
  })

  // Determine if props.agent is the currently active primary agent or a different agent
  const isConfiguringCurrentAgent = createMemo(() => {
    if (!props.agent) return true
    return props.agent === local.agent.current()?.name
  })

  async function persistAgentModelToConfig(agentName: string, providerID: string, modelID: string) {
    const workspace = undefined // instance-level config
    try {
      const res = await sdk.client.config.get({ workspace })
      if (res.error || !res.data) return
      const current = res.data as Record<string, unknown>
      const currentAgents = (current.agent ?? {}) as Record<string, Record<string, unknown>>
      const currentAgentCfg = currentAgents[agentName] ?? {}
      await sdk.client.config.update({
        workspace,
        config: {
          ...current,
          agent: {
            ...currentAgents,
            [agentName]: {
              ...currentAgentCfg,
              model: `${providerID}/${modelID}`,
            },
          },
        } as Parameters<typeof sdk.client.config.update>[0]["config"],
      })
    } catch {
      // best-effort: don't break the dialog if config persistence fails
    }
  }

  function onSelect(providerID: string, modelID: string) {
    if (isConfiguringCurrentAgent()) {
      // Setting model for the active primary agent — use TUI in-memory state only
      local.model.set({ providerID, modelID }, { recent: true, agent: props.agent })
    } else {
      // Setting model for a different agent (e.g. a subagent):
      // - Store in TUI memory (without polluting `recent` — local.tsx guards this)
      // - Also persist to server config so server-side task spawning uses the right model
      local.model.set({ providerID, modelID }, { recent: false, agent: props.agent })
      void persistAgentModelToConfig(props.agent!, providerID, modelID)
    }

    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0 && isConfiguringCurrentAgent()) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          disabled: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}
