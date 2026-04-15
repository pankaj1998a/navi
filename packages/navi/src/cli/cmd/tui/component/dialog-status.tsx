import { TextAttributes } from "@opentui/core"
import { fileURLToPath } from "bun"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { For, Match, Switch, Show, createMemo } from "solid-js"

export type DialogStatusProps = {}

export function DialogStatus() {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()

  const enabledFormatters = createMemo(() => sync.data.formatter.filter((f) => f.enabled))

  const plugins = createMemo(() => {
    const list = sync.data.config.plugin ?? []
    const result = list.map((item) => {
      const value = typeof item === "string" ? item : item[0]
      if (value.startsWith("file://")) {
        const path = fileURLToPath(value)
        const parts = path.split("/")
        const filename = parts.pop() || path
        if (!filename.includes(".")) return { name: filename }
        const basename = filename.split(".")[0]
        if (basename === "index") {
          const dirname = parts.pop()
          const name = dirname || basename
          return { name }
        }
        return { name: basename }
      }
      const index = value.lastIndexOf("@")
      if (index <= 0) return { name: value, version: "latest" }
      const name = value.substring(0, index)
      const version = value.substring(index + 1)
      return { name, version }
    })
    return result.toSorted((a, b) => a.name.localeCompare(b.name))
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Status
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={Object.keys(sync.data.mcp).length > 0} fallback={<text fg={theme.text}>No MCP Servers</text>}>
        <box>
          <text fg={theme.text}>{String(Object.keys(sync.data.mcp).length)} MCP Servers</text>
          <For each={Object.entries(sync.data.mcp)}>
            {([key, item]) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  fg={(
                      {
                        connected: theme.success,
                        failed: theme.error,
                        disabled: theme.textMuted,
                        needs_auth: theme.warning,
                        needs_client_registration: theme.error,
                      } as Record<string, typeof theme.success>
                    )[item.status]}
                >
                  •
                </text>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>{String(key)}</text>
                  <text fg={theme.textMuted}>
                    <Switch fallback={String(item.status)}>
                      <Match when={item.status === "connected"}>Connected</Match>
                      <Match when={item.status === "failed" && item}>{(val) => String(val().error)}</Match>
                      <Match when={item.status === "disabled"}>Disabled in configuration</Match>
                      <Match when={(item.status as string) === "needs_auth"}>
                        Needs authentication (run: Navi mcp auth {String(key)})
                      </Match>
                      <Match when={(item.status as string) === "needs_client_registration" && item}>
                        {(val) => String((val() as { error: string }).error)}
                      </Match>
                    </Switch>
                  </text>
                </box>
              </box>
            )}
          </For>
        </box>
      </Show>
      {sync.data.lsp.length > 0 && (
        <box>
          <text fg={theme.text}>{String(sync.data.lsp.length)} LSP Servers</text>
          <For each={sync.data.lsp}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  fg={{
                      connected: theme.success,
                      error: theme.error,
                    }[item.status]}
                >
                  •
                </text>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>{String(item.id)}</text>
                  <text fg={theme.textMuted}>{String(item.root)}</text>
                </box>
              </box>
            )}
          </For>
        </box>
      )}
      <Show when={enabledFormatters().length > 0} fallback={<text fg={theme.text}>No Formatters</text>}>
        <box>
          <text fg={theme.text}>{String(enabledFormatters().length)} Formatters</text>
          <For each={enabledFormatters()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={theme.success}>
                  •
                </text>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>{String(item.name)}</text>
                </box>
              </box>
            )}
          </For>
        </box>
      </Show>
      <Show when={plugins().length > 0} fallback={<text fg={theme.text}>No Plugins</text>}>
        <box>
          <text fg={theme.text}>{String(plugins().length)} Plugins</text>
          <For each={plugins()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={theme.success}>
                  •
                </text>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>{String(item.name)}</text>
                  <Show when={item.version}>
                    <text fg={theme.textMuted}>@{String(item.version)}</text>
                  </Show>
                </box>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

