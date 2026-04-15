import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    // Track all timeouts to ensure proper cleanup
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeouts.push(setTimeout(() => tick(), 5000))
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeouts.push(setTimeout(() => tick(), 10_000))
        return
      }
    }
    timeouts.push(setTimeout(() => tick(), 10_000))

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
    })
  })

  // ─── Token & Cost Tracker ───────────────────────────────────────────────────
  const costSummary = createMemo(() => {
    if (route.data.type !== "session") return { cost: 0, tokens: 0 }
    
    // TUI messages are nested within sync.data.message
    // The structure is an array of Message objects
    const messages = sync.data.message?.[route.data.sessionID] ?? []
    
    let totalCost = 0
    let totalTokens = 0
    
    for (const msg of messages) {
      if (msg.role === "assistant") {
        totalCost += msg.cost ?? 0
        totalTokens += (msg.tokens?.input ?? 0) + (msg.tokens?.output ?? 0)
      }
    }
    
    return { cost: totalCost, tokens: totalTokens }
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <text fg={theme.textMuted}>/connect</text>
            </text>
          </Match>
          <Match when={connected()}>
            {/* Tokens and Cost Display */}
            <Show when={costSummary().tokens > 0}>
              <text fg={theme.warning}>
                {costSummary().tokens > 1000 ? (costSummary().tokens / 1000).toFixed(1) + "k" : String(costSummary().tokens)} tokens / ${costSummary().cost.toFixed(3)}
              </text>
            </Show>

            <Show when={permissions().length > 0}>
              <box gap={0} flexDirection="row">
                <text fg={theme.warning}>△</text>
                <text fg={theme.warning}> {String(permissions().length)} Permission{permissions().length > 1 ? "s" : ""}</text>
              </box>
            </Show>
            <box gap={0} flexDirection="row">
              <text fg={lsp().length > 0 ? theme.success : theme.textMuted}>•</text>
              <text fg={theme.text}> {String(lsp().length)} LSP</text>
            </box>
            <Show when={mcp()}>
              <box gap={0} flexDirection="row">
                <Switch>
                  <Match when={mcpError()}>
                    <text fg={theme.error}>⊙ </text>
                  </Match>
                  <Match when={true}>
                    <text fg={theme.success}>⊙ </text>
                  </Match>
                </Switch>
                <text fg={theme.text}>{String(mcp())} MCP</text>
              </box>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}

