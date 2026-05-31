import { Buddy } from "@/buddy"
import { useTheme } from "@tui/context/theme"
import { createMemo, createSignal, onMount, onCleanup, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useLocal } from "@tui/context/local"
import { useKV } from "@tui/context/kv"
import type { AssistantMessage } from "@navi-ai/sdk/v2"
import { Locale } from "@/util/locale"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function BuddyHeader() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const local = useLocal()
  const kv = useKV()
  const buddy = createMemo(() => Buddy.get(kv.get("buddy_species", undefined) as Buddy.Species))

  const [tipIndex, setTipIndex] = createSignal(0)
  const [blink, setBlink] = createSignal(false)

  onMount(() => {
    const tipInterval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % (buddy().tips.length || 1))
    }, 30000)

    const blinkInterval = setInterval(() => {
      if (Math.random() > 0.7) {
        setBlink(true)
        setTimeout(() => setBlink(false), 200)
      }
    }, 3000)

    onCleanup(() => {
      clearInterval(tipInterval)
      clearInterval(blinkInterval)
    })
  })

  const currentStatus = createMemo(() => {
    if (route.data.type !== "session") return "idle"
    return sync.session.status((route.data as any).sessionID)
  })

  const displayIcon = createMemo(() => {
    const status = currentStatus()
    const b = buddy()

    if (status === "working") return b.reactions.working
    if (status === "compacting") return b.reactions.thinking

    if (route.data.type === "session") {
      const messages = sync.data.message[(route.data as any).sessionID] ?? []
      const last = messages.at(-1)
      if (last && last.role === "assistant" && last.time.completed) {
        return b.reactions.success
      }
    }

    return blink() ? b.reactions.thinking : b.reactions.idle
  })

  const displayMessage = createMemo(() => {
    const status = currentStatus()
    if (status === "working") return "I'm working on it..."
    if (status === "compacting") return "Just tidying up the session..."

    const b = buddy()
    const metadata = [
      b.rarity !== "common" ? b.rarity : "",
      b.shiny ? "shiny" : "",
    ].filter(Boolean).join(" ")

    const prefix = metadata ? `[${metadata}] ` : ""
    return prefix + (b.tips[tipIndex()] || b.greeting)
  })

  const usage = createMemo(() => {
    if (route.data.type !== "session") return
    const messages = sync.data.message[route.data.sessionID] ?? []

    let totalTokens = 0
    let totalCost = 0

    for (const msg of messages) {
      if (msg.role === "assistant") {
        totalTokens += (msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write)
        totalCost += msg.cost
      }
    }

    const last = messages.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)

    return {
      totalTokens: Locale.number(totalTokens),
      lastTokens: last ? Locale.number(last.tokens.input + last.tokens.output) : undefined,
      cost: totalCost > 0 ? money.format(totalCost) : undefined,
    }
  })


  const currentModel = createMemo(() => {
    const m = local.model.parsed()
    return m.model
  })

  const sessionInfo = createMemo(() => {
    if (route.data.type !== "session") return ""
    return "· " + String((route.data as any).sessionID || "").slice(4, 12)
  })

  const totalTokens = createMemo(() => usage()?.totalTokens || "")
  const usageSuffix = createMemo(() => {
    const u = usage()
    if (!u) return ""
    return ` tokens${u.cost ? " · " + String(u.cost) : ""}`
  })

  if (!buddy()) return <box />

  return (
    <box
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.backgroundElement}
    >
      <box flexDirection="row" justifyContent="space-between" marginBottom={0}>
        <box flexDirection="row" gap={2}>
          <text fg={currentStatus() === "working" ? theme.primary : theme.text} attributes={TextAttributes.BOLD}>{String(displayIcon())}</text>
          <text fg={theme.text} wrapMode="none" maxWidth={80}>{String(displayMessage())}</text>
        </box>
        <Show when={currentModel()}>
          <text fg={theme.textMuted} wrapMode="none">
            {String(currentModel())}{sessionInfo() ? " " + sessionInfo() : ""}
          </text>
        </Show>
      </box>
      <Show when={totalTokens()}>
        <box flexDirection="row" gap={1} marginTop={0}>
          <text fg={theme.textMuted}>{totalTokens()}{usageSuffix()}</text>
        </box>
      </Show>
    </box>
  )
}
