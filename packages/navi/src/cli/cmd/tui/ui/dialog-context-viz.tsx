import { createMemo, For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useDialog } from "@tui/ui/dialog"
import { TextAttributes } from "@opentui/core"

export function DialogContextViz() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const dialog = useDialog()

  const sessionID = createMemo(() => {
    if (route.data.type === "session") return route.data.sessionID
    return undefined
  })

  const messages = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return (sync.data.message[id] || [])
  })

  const stats = createMemo(() => {
    const msgs = messages()
    let total = 0
    let input = 0
    let output = 0
    let reasoning = 0
    const files = new Map<string, number>()

    for (const msg of msgs) {
      if (msg.role === "assistant" && msg.tokens) {
        total += msg.tokens.total ?? (msg.tokens.input + msg.tokens.output)
        input += msg.tokens.input
        output += msg.tokens.output
        reasoning += msg.tokens.reasoning
      }
      
      const parts = sync.data.part[msg.id] || []
      for (const part of parts) {
          if (part.type === "file") {
              const path = part.filename || part.url;
              if (path) {
                  const current = files.get(path) ?? 0;
                  files.set(path, current + 1);
              }
          }
      }
    }

    return { total, input, output, reasoning, files: Array.from(files.entries()).sort((a,b) => b[1] - a[1]) }
  })

  return (
    <box padding={2} gap={1}>
        <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Context Visualization
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>

        <box padding={1} gap={1}>
          <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
            🌌 Session Memory Profile
          </text>
          
          <box flexDirection="column" gap={0}>
            <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
              <text fg={theme.text}>Total Tokens</text>
              <text fg={theme.accent}>{stats().total.toLocaleString()}</text>
            </box>
            
            <box height={1} width="100%" flexDirection="row" backgroundColor={theme.backgroundElement}>
                <box 
                    width={`${(stats().input / (stats().total || 1)) * 100}%`} 
                    backgroundColor={theme.info}
                    height={1}
                />
                <box 
                    width={`${(stats().output / (stats().total || 1)) * 100}%`} 
                    backgroundColor={theme.success}
                    height={1}
                />
                <box 
                    width={`${(stats().reasoning / (stats().total || 1)) * 100}%`} 
                    backgroundColor={theme.warning}
                    height={1}
                />
            </box>

            <box flexDirection="row" gap={2} marginTop={1} marginBottom={1}>
                <box flexDirection="row" alignItems="center" gap={1}>
                    <box width={1} height={1} backgroundColor={theme.info} />
                    <text fg={theme.textMuted}>In: {String(Math.round((stats().input / (stats().total || 1)) * 100))}%</text>
                </box>
                <box flexDirection="row" alignItems="center" gap={1}>
                    <box width={1} height={1} backgroundColor={theme.success} />
                    <text fg={theme.textMuted}>Out: {String(Math.round((stats().output / (stats().total || 1)) * 100))}%</text>
                </box>
                <Show when={stats().reasoning > 0}>
                    <box flexDirection="row" alignItems="center" gap={1}>
                        <box width={1} height={1} backgroundColor={theme.warning} />
                        <text fg={theme.textMuted}>Reason: {String(Math.round((stats().reasoning / (stats().total || 1)) * 100))}%</text>
                    </box>
                </Show>
            </box>

            <box height={1} backgroundColor={theme.border} marginTop={1} marginBottom={1} />

            <box marginTop={0}>
                <text fg={theme.secondary} marginBottom={1}>Top Files in Context:</text>
                <For each={stats().files.slice(0, 5)}>
                    {([file, count]) => (
                        <box flexDirection="row" justifyContent="space-between">
                            <text fg={theme.text} overflow="hidden">{file}</text>
                            <text fg={theme.textMuted}>{String(count)} refs</text>
                        </box>
                    )}
                </For>
            </box>
          </box>
        </box>
    </box>
  )
}
