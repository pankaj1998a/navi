import { Popover as Kobalte } from "@kobalte/core/popover"
import { type Component, For, Show, createMemo, createSignal } from "solid-js"
import { ProviderIcon } from "@navi-ai/ui/provider-icon"
import { Button } from "@navi-ai/ui/button"
import { Tag } from "@navi-ai/ui/tag"
import { List } from "@navi-ai/ui/list"
import { Tooltip } from "@navi-ai/ui/tooltip"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useGlobalSync } from "@/context/global-sync"
import { useModels } from "@/context/models"
import { popularProviders } from "@/hooks/use-providers"
import { SettingsList } from "./settings-list"


const isFree = (provider: string, cost: { input: number | string } | undefined) =>
  provider === "navi" && (!cost || cost.input === 0 || cost.input === "0")

// A standalone model-picker popover that calls onSelect with the chosen model
const AgentModelPicker: Component<{
  currentModelID?: string
  currentProviderID?: string
  onSelect: (providerID: string, modelID: string) => void
}> = (props) => {
  const language = useLanguage()
  const models = useModels()
  const [open, setOpen] = createSignal(false)

  const currentModel = createMemo(() => {
    if (!props.currentModelID || !props.currentProviderID) return undefined
    return models.find({ providerID: props.currentProviderID, modelID: props.currentModelID })
  })

  const visibleModels = createMemo(() =>
    models
      .list()
      .filter((m) => models.visible({ modelID: m.id, providerID: m.provider.id })),
  )

  const current = createMemo(() => {
    if (!props.currentModelID || !props.currentProviderID) return undefined
    return visibleModels().find((m) => m.id === props.currentModelID && m.provider.id === props.currentProviderID)
  })

  return (
    <Kobalte
      open={open()}
      onOpenChange={(next) => {
        setOpen(next)
      }}
      modal={false}
      placement="bottom-start"
      gutter={4}
    >
      <Kobalte.Trigger as="div" class="cursor-pointer">
        <div class="flex items-center gap-1.5 px-2.5 h-7 rounded-md border border-border-base bg-surface-base hover:bg-surface-stronger text-12-regular text-text-base min-w-[140px] max-w-[220px]">
          <Show
            when={currentModel()}
            fallback={<span class="text-text-weak">{language.t("settings.agents.model.default")}</span>}
          >
            {(m) => (
              <>
                <ProviderIcon id={m().provider.id} class="size-3.5 shrink-0 icon-base" />
                <span class="truncate">{m().name}</span>
              </>
            )}
          </Show>
        </div>
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class="w-72 h-80 flex flex-col p-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden"
          onEscapeKeyDown={(event) => {
            setOpen(false)
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDownOutside={() => {
            setOpen(false)
          }}
          onFocusOutside={() => {
            setOpen(false)
          }}
        >
          <Kobalte.Title class="sr-only">Select model</Kobalte.Title>
          <List
            class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 p-1"
            search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
            emptyMessage={language.t("dialog.model.empty")}
            key={(x) => `${x.provider.id}:${x.id}`}
            items={visibleModels}
            current={current()}
            filterKeys={["provider.name", "name", "id"]}
            sortBy={(a, b) => a.name.localeCompare(b.name)}
            groupBy={(x) => x.provider.name}
            sortGroupsBy={(a, b) => {
              const aProvider = a.items[0].provider.id
              const bProvider = b.items[0].provider.id
              if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
              if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
              return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
            }}
            itemWrapper={(item, node) => (
              <Tooltip
                class="w-full"
                placement="right-start"
                gutter={12}
                value={<ModelTooltip model={item} latest={item.latest} free={isFree(item.provider.id, item.cost)} />}
              >
                {node}
              </Tooltip>
            )}
            onSelect={(x) => {
              if (x) {
                props.onSelect(x.provider.id, x.id)
              }
              setOpen(false)
            }}
          >
            {(i) => (
              <div class="w-full flex items-center gap-x-2 text-13-regular">
                <span class="truncate">{i.name}</span>
                <Show when={isFree(i.provider.id, i.cost)}>
                  <Tag>{language.t("model.tag.free")}</Tag>
                </Show>
                <Show when={i.latest}>
                  <Tag>{language.t("model.tag.latest")}</Tag>
                </Show>
              </div>
            )}
          </List>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}

export const SettingsAgents: Component = () => {
  const language = useLanguage()
  const sync = useSync()
  const globalSync = useGlobalSync()

  // All agents excluding hidden utility agents (title, summary, compaction)
  const agents = createMemo(() => sync.data.agent.filter((a) => !a.hidden))

  const agentConfigModel = (agentName: string): string | undefined => {
    return globalSync.data.config.agent?.[agentName]?.model as string | undefined
  }

  const parseConfigModel = (cfgModel: string | undefined) => {
    if (!cfgModel) return undefined
    const slashIdx = cfgModel.indexOf("/")
    if (slashIdx < 0) return undefined
    return { providerID: cfgModel.slice(0, slashIdx), modelID: cfgModel.slice(slashIdx + 1) }
  }

  const setAgentModel = async (agentName: string, providerID: string, modelID: string) => {
    const current = globalSync.data.config
    await globalSync.updateConfig({
      ...current,
      agent: {
        ...current.agent,
        [agentName]: {
          ...current.agent?.[agentName],
          model: `${providerID}/${modelID}`,
        },
      },
    })
  }

  const clearAgentModel = async (agentName: string) => {
    const current = globalSync.data.config
    const { model: _model, ...restAgentCfg } = (current.agent?.[agentName] ?? {}) as Record<string, unknown>
    await globalSync.updateConfig({
      ...current,
      agent: {
        ...current.agent,
        [agentName]: restAgentCfg as NonNullable<typeof current.agent>[string],
      },
    })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.agents.title")}</h2>
          <p class="text-12-regular text-text-weak">{language.t("settings.agents.model.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full max-w-[720px]">
        <SettingsList>
          <For each={agents()}>
            {(agent) => {
              const cfgModelStr = createMemo(() => agentConfigModel(agent.name))
              const cfgModel = createMemo(() => parseConfigModel(cfgModelStr()))

              return (
                <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
                  {/* Left: agent name + badge + description */}
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div class="flex items-center gap-2">
                      <span class="text-14-medium text-text-strong">@{agent.name}</span>
                      <Show when={agent.mode === "primary"}>
                        <span class="text-10-medium text-text-weak bg-surface-base px-1.5 py-0.5 rounded">
                          {language.t("settings.agents.badge.primary")}
                        </span>
                      </Show>
                      <Show when={agent.mode === "subagent"}>
                        <span class="text-10-medium text-text-weak bg-surface-base px-1.5 py-0.5 rounded">
                          {language.t("settings.agents.badge.subagent")}
                        </span>
                      </Show>
                    </div>
                    <Show when={agent.description}>
                      <span class="text-12-regular text-text-weak line-clamp-1">{agent.description}</span>
                    </Show>
                  </div>

                  {/* Right: model picker + reset */}
                  <div class="flex items-center gap-2 flex-shrink-0">
                    <AgentModelPicker
                      currentProviderID={cfgModel()?.providerID}
                      currentModelID={cfgModel()?.modelID}
                      onSelect={(providerID, modelID) => setAgentModel(agent.name, providerID, modelID)}
                    />
                    <Show when={cfgModelStr()}>
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={() => clearAgentModel(agent.name)}
                        class="text-text-weak hover:text-text-base"
                      >
                        {language.t("common.reset")}
                      </Button>
                    </Show>
                  </div>
                </div>
              )
            }}
          </For>
        </SettingsList>
      </div>
    </div>
  )
}
