import { createEffect, on } from "solid-js"
import { createSignal } from "solid-js"
import { createSimpleContext } from "./helper"
import { useEvent } from "./event"
import { useRoute } from "./route"

export const { use: useSessionTabs, provider: SessionTabsProvider } = createSimpleContext({
  name: "SessionTabs",
  init: () => {
    const route = useRoute()
    const event = useEvent()
    const [tabs, setTabs] = createSignal<string[]>([])

    const active = () => (route.data.type === "session" ? route.data.sessionID : undefined)

    createEffect(
      on(active, (sessionID) => {
        if (!sessionID || sessionID === "dummy") return
        setTabs((current) => (current.includes(sessionID) ? current : [...current, sessionID]))
      }),
    )

    event.on("session.deleted", (evt) => {
      const id = evt.properties.info.id
      setTabs((current) => current.filter((tab) => tab !== id))
    })

    function select(sessionID: string) {
      if (active() === sessionID) return
      route.navigate({ type: "session", sessionID })
    }

    function open(sessionID: string) {
      setTabs((current) => (current.includes(sessionID) ? current : [...current, sessionID]))
    }

    function close(sessionID?: string) {
      const target = sessionID ?? active()
      if (!target) return
      const current = tabs()
      const remaining = current.filter((tab) => tab !== target)
      setTabs(remaining)
      if (active() !== target) return
      const next = remaining[Math.min(current.indexOf(target), remaining.length - 1)]
      route.navigate(next ? { type: "session", sessionID: next } : { type: "home" })
    }

    function cycle(direction: 1 | -1) {
      const current = tabs()
      if (current.length === 0) return
      const index = current.indexOf(active() ?? "")
      const next = current[(index + direction + current.length) % current.length]
      if (next) select(next)
    }

    function selectIndex(index: number) {
      const tab = tabs()[index]
      if (tab) select(tab)
    }

    return {
      tabs,
      active,
      open,
      select,
      close,
      cycle,
      selectIndex,
    }
  },
})
