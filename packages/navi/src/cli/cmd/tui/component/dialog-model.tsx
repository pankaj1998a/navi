import { createMemo, createSignal, Show } from "solid-js"
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
import { useTheme } from "@tui/context/theme"

export function DialogModel(props: { providerID?: string; agent?: string }) {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => connected() && !props.providerID)

  function staleBadge(model: any): string | undefined {
    const catalog = (model as any)?.catalog as { source?: string; fetchedAt?: string; ageMs?: number } | undefined
    if (!catalog || catalog.source !== "stale-cache") return undefined
    const ageMs = catalog.ageMs ?? (catalog.fetchedAt ? Date.now() - new Date(catalog.fetchedAt).getTime() : 0)
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000))
    const age = days > 0 ? `${days}d` : `${Math.floor(ageMs / (60 * 60 * 1000))}h`
    return `cached ${age} ago · stale`
  }

  function modelFooter(model: any, fallback?: string): string | import("solid-js").JSX.Element | undefined {
    const badge = staleBadge(model)
    if (badge) {
      // yellow stale badge - combine with fallback if present
      const text = fallback ? `${fallback} · ${badge}` : badge
      return (<span style={{ fg: theme.warning }}>{text}</span>) as any
    }
    return fallback
  }

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
        const free = model.cost?.input === 0 && provider.id === "navi" ? "Free" : undefined
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            title: model.name ?? item.modelID,
            description: provider.name,
            category,
            disabled: provider.id === "navi" && model.id.includes("-nano"),
            footer: modelFooter(model, free),
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
          map(([model, info]) => {
            const free = info.cost?.input === 0 && provider.id === "navi" ? "Free" : undefined
            return {
              value: { providerID: provider.id, modelID: model },
              title: info.name ?? model,
              description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
                ? "(Favorite)"
                : undefined,
              category: connected() ? provider.name : undefined,
              disabled: provider.id === "navi" && model.includes("-nano"),
              footer: modelFooter(info, free),
              onSelect() {
                onSelect(provider.id, model)
              },
            }
          }),
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
        } as NonNullable<Parameters<typeof sdk.client.config.update>[0]>["config"],
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

  const selectedStale = createMemo(() => {
    const cur = local.model.current()
    if (!cur) return undefined
    const provider = sync.data.provider.find((p) => p.id === cur.providerID)
    const model = provider?.models[cur.modelID] as any
    return staleBadge(model)
  })

  return (
    <box flexDirection="column" gap={1}>
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
      <Show when={selectedStale()}>
        {(badge) => (
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.warning}>{badge()}</text>
          </box>
        )}
      </Show>
    </box>
  )
}
