import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useSessionTabs } from "../context/session-tabs"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"
import { isDefaultTitle } from "../util/session"
import { Spinner } from "./spinner"

const TITLE_WIDTH = 24

export function SessionTabs() {
  const tabs = useSessionTabs()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <Show when={tabs.tabs().length > 0}>
      <box
        flexDirection="row"
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        gap={1}
        border={["bottom"]}
        borderColor={theme.borderSubtle}
      >
        <For each={tabs.tabs()}>
          {(sessionID, index) => {
            const title = () => {
              const current = sync.session.get(sessionID)?.title
              if (!current || isDefaultTitle(current)) return "New session"
              return Locale.truncate(current, TITLE_WIDTH)
            }
            const working = () => sync.session.status(sessionID) !== "idle"
            const selected = () => tabs.active() === sessionID
            return (
              <box
                flexDirection="row"
                flexShrink={0}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={selected() ? theme.backgroundElement : undefined}
                onMouseUp={() => tabs.select(sessionID)}
              >
                <Show when={index() < 9}>
                  <text
                    fg={selected() ? theme.accent : theme.textMuted}
                    attributes={selected() ? TextAttributes.BOLD : undefined}
                    selectable={false}
                  >
                    {`${index() + 1} `}
                  </text>
                </Show>
                <Show when={working()}>
                  <Spinner />
                  <text selectable={false}> </text>
                </Show>
                <text
                  fg={selected() ? theme.text : theme.textMuted}
                  attributes={selected() ? TextAttributes.BOLD : undefined}
                  selectable={false}
                >
                  {title()}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </Show>
  )
}
