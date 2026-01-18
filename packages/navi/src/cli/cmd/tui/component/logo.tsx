import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"

// ASCII art for "NAVI"
const LOGO = [
  `███╗   ██╗ █████╗ ██╗   ██╗██╗`,
  `████╗  ██║██╔══██╗██║   ██║██║`,
  `██╔██╗ ██║███████║██║   ██║██║`,
  `██║╚██╗██║██╔══██║╚██╗ ██╔╝██║`,
  `██║ ╚████║██║  ██║ ╚████╔╝ ██║`,
  `╚═╝  ╚═══╝╚═╝  ╚═╝  ╚═══╝  ╚═╝`,
]

export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <For each={LOGO}>
        {(line) => (
          <box flexDirection="row">
            <text fg={theme.primary} attributes={TextAttributes.BOLD} selectable={false}>
              {line}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
