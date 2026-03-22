import { type Accessor, createMemo, createSignal, Match, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage, Session } from "@navi-ai/sdk/v2"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "../../context/keybind"
import { Locale } from "@/util/locale"

const Title = (props: { session: Accessor<Session> }) => {
  const { theme } = useTheme()
  return (
    <text fg={theme.text}>
      <span style={{ bold: true }}>#</span> <span style={{ bold: true }}>{props.session().title}</span>
    </text>
  )
}

function formatProviderAuth(source?: string) {
  switch (source) {
    case "env":
      return "connected"
    case "api":
      return "connected"
    case "config":
      return "configured"
    case "free":
      return "free"
    default:
      return source
  }
}

const ContextInfo = (props: { summary: Accessor<string | undefined> }) => {
  const { theme } = useTheme()
  return (
    <Show when={props.summary()}>
      <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
        {props.summary()}
      </text>
    </Show>
  )
}

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const status = createMemo(() => sync.data.session_status[route.sessionID])

  const cost = createMemo(() => {
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const provider = sync.data.provider.find((x) => x.id === last.providerID)
    const model = provider?.models[last.modelID]
    const contextLimit = model?.limit.context
    const contextSummary = contextLimit
      ? `${total.toLocaleString()} / ${contextLimit.toLocaleString()} (${Math.round((total / contextLimit) * 100)}%)`
      : total.toLocaleString()
    const auth = formatProviderAuth(provider?.source)
    const costSummary = cost()
    return [provider?.name ?? last.providerID, auth, model?.name ?? last.modelID, contextSummary, costSummary]
      .filter(Boolean)
      .join(" · ")
  })

  const sessionHealth = createMemo(() => {
    const current = status()
    if (!current) return undefined
    const parts: string[] = []
    if (current.phase) parts.push(Locale.titlecase(current.phase))
    if (current.activeAgents?.length) parts.push(`${current.activeAgents.length} agent${current.activeAgents.length === 1 ? "" : "s"}`)
    if (current.blockedReason) parts.push(`blocked: ${current.blockedReason}`)
    if (current.nextAction) parts.push(`next: ${current.nextAction}`)
    return parts.length ? parts.join(" · ") : undefined
  })

  const { theme } = useTheme()
  const keybind = useKeybind()
  const command = useCommandDialog()
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null)

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
        <Switch>
          <Match when={session()?.parentID}>
            <box flexDirection="row" gap={2}>
              <text fg={theme.text}>
                <b>Subagent session</b>
              </text>
              <box
                onMouseOver={() => setHover("parent")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => command.trigger("session.parent")}
                backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.backgroundPanel}
              >
                <text fg={theme.text}>
                  Parent <span style={{ fg: theme.textMuted }}>{keybind.print("session_parent")}</span>
                </text>
              </box>
              <box
                onMouseOver={() => setHover("prev")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => command.trigger("session.child.previous")}
                backgroundColor={hover() === "prev" ? theme.backgroundElement : theme.backgroundPanel}
              >
                <text fg={theme.text}>
                  Prev <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle_reverse")}</span>
                </text>
              </box>
              <box
                onMouseOver={() => setHover("next")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => command.trigger("session.child.next")}
                backgroundColor={hover() === "next" ? theme.backgroundElement : theme.backgroundPanel}
              >
                <text fg={theme.text}>
                  Next <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle")}</span>
                </text>
              </box>
              <box flexGrow={1} flexShrink={1} />
              <ContextInfo summary={context} />
            </box>
          </Match>
          <Match when={true}>
            <box flexDirection="row" justifyContent="space-between" gap={1}>
              <box flexDirection="column" gap={0}>
                <Title session={session} />
                <Show when={sessionHealth()}>
                  <text fg={theme.textMuted}>{sessionHealth()}</text>
                </Show>
              </box>
              <ContextInfo summary={context} />
            </box>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
