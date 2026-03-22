import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { Locale } from "@/util/locale"
import { Flag } from "@/flag/flag"

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
  const questions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.question[route.data.sessionID] ?? []
  })
  const sessionStatus = createMemo(() => {
    if (route.data.type !== "session") return undefined
    return sync.data.session_status[route.data.sessionID]
  })
  const messages = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.message[route.data.sessionID] ?? []
  })
  const assistantCost = createMemo(() =>
    messages().reduce((total, message) => total + (message.role === "assistant" ? message.cost : 0), 0),
  )
  const directory = useDirectory()
  const connected = useConnected()

  const runningAgents = createMemo(() =>
    Object.values(sync.data.session_status).filter((s) => s.type === "busy" || s.type === "retry").length
  )
  const toolCalls = createMemo(() => {
    let total = 0
    for (const parts of Object.values(sync.data.part)) {
      total += parts.filter((p) => p.type === "tool" || p.type === "subtask").length
    }
    return total
  })
  const budgetWarning = createMemo(() => {
    if (!Flag.NAVI_MAX_BUDGET_USD || route.data.type !== "session") return undefined
    return `$${assistantCost().toFixed(2)} / $${Flag.NAVI_MAX_BUDGET_USD.toFixed(2)}`
  })
  const turnWarning = createMemo(() => {
    if (!Flag.NAVI_MAX_TURNS || route.data.type !== "session") return undefined
    return `${messages().filter((message) => message.role === "assistant").length} / ${Flag.NAVI_MAX_TURNS} turns`
  })
  const stateBadge = createMemo(() => {
    const pending = permissions().length + questions().length
    const status = sessionStatus()
    if (pending > 0) {
      return {
        label: "Blocked",
        icon: "!",
        color: theme.warning,
      }
    }
    if (status?.type === "retry") {
      return {
        label: `Retry ${status.attempt}`,
        icon: "↻",
        color: theme.warning,
      }
    }
    if (status?.type === "busy") {
      return {
        label: "Running",
        icon: "●",
        color: theme.success,
      }
    }
    if (messages().some((message) => message.role === "assistant")) {
      return {
        label: "Complete",
        icon: "✓",
        color: theme.success,
      }
    }
    return {
      label: "Idle",
      icon: "○",
      color: theme.textMuted,
    }
  })
  const statusDetail = createMemo(() => {
    const status = sessionStatus()
    if (!status) return undefined
    const parts: string[] = []
    if (status.phase) parts.push(Locale.titlecase(status.phase))
    if (status.activeAgents?.length) parts.push(`agents: ${status.activeAgents.join(", ")}`)
    if (status.blockedReason) parts.push(`blocked: ${status.blockedReason}`)
    if (status.nextAction) parts.push(`next: ${status.nextAction}`)
    return parts.length ? parts.join(" · ") : undefined
  })
  const modeBadge = createMemo(() => {
    const status = sessionStatus()
    if (!status?.permissionMode) return undefined
    return Locale.titlecase(status.permissionMode)
  })
  const thinkingBadge = createMemo(() => {
    const status = sessionStatus()
    if (!status?.thinkingLevel) return undefined
    return Locale.titlecase(status.thinkingLevel)
  })

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    let timeout: NodeJS.Timeout
    let isMounted = true

    function tick() {
      if (!isMounted || connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeout = setTimeout(() => tick(), 5000)
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeout = setTimeout(() => tick(), 10_000)
        return
      }
    }
    timeout = setTimeout(() => tick(), 10_000)

    onCleanup(() => {
      isMounted = false
      clearTimeout(timeout)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <Show when={questions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>?</span> {questions().length} Question
                {questions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <Show when={sessionStatus()}>
              <text fg={stateBadge().color}>
                <span style={{ fg: stateBadge().color }}>{stateBadge().icon}</span> {stateBadge().label}
              </text>
            </Show>
            <Show when={modeBadge()}>
              <text fg={theme.text}>
                <span style={{ fg: theme.textMuted }}>◈</span> {modeBadge()}
              </text>
            </Show>
            <Show when={thinkingBadge()}>
              <text fg={theme.text}>
                <span style={{ fg: theme.textMuted }}>◌</span> {thinkingBadge()}
              </text>
            </Show>
            <Show when={statusDetail()}>
              <text fg={theme.textMuted}>
                <span style={{ fg: theme.textMuted }}>▸</span> {statusDetail()}
              </text>
            </Show>
            <Show when={budgetWarning()}>
              <text fg={theme.text}>
                <span style={{ fg: theme.warning }}>⛁</span> {budgetWarning()}
              </text>
            </Show>
            <Show when={turnWarning()}>
              <text fg={theme.text}>
                <span style={{ fg: theme.textMuted }}>↻</span> {turnWarning()}
              </text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <text fg={theme.text}>
              <span style={{ fg: runningAgents() > 0 ? theme.success : theme.textMuted }}>●</span> {runningAgents()} Agent{runningAgents() !== 1 ? "s" : ""}
            </text>
            <text fg={theme.text}>
              <span style={{ fg: theme.textMuted }}>⚙</span> {toolCalls()} Tool Call{toolCalls() !== 1 ? "s" : ""}
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
