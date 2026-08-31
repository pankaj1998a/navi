import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useBindings, useCommandShortcut } from "../keymap"
import { TuiKeybind } from "../config/keybind"
import { For } from "solid-js"

const quickRef: { title: string; keys: string[] }[] = [
  { title: "Session", keys: ["session_new", "session_list", "session_timeline", "session_rename", "session_compact", "session_interrupt", "messages_page_up", "messages_page_down"] },
  { title: "Prompt", keys: ["prompt_submit", "input_submit", "input_newline", "history_previous", "history_next", "prompt_stash", "prompt_stash_pop"] },
  { title: "Agent", keys: ["agent_list", "agent_cycle", "agent_cycle_reverse", "model_list", "model_cycle_recent", "variant_cycle", "mcp_list"] },
]

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const commandShortcut = useCommandShortcut("command.palette.show")

  useBindings(() => ({
    bindings: [
      { key: "return", desc: "Close help", group: "Dialog", cmd: () => dialog.clear() },
      { key: "escape", desc: "Close help", group: "Dialog", cmd: () => dialog.clear() },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Help
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc/enter
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>
          Press {commandShortcut()} to see all available actions and commands in any context.
        </text>
      </box>
      <box flexDirection="row" gap={2} paddingBottom={1}>
        <For each={quickRef}>
          {(group) => (
            <box flexDirection="column" flexGrow={1}>
              <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                {group.title}
              </text>
              <For each={group.keys}>
                {(key) => (
                  <text fg={theme.textMuted} wrapMode="none">
                    {(TuiKeybind.Descriptions as Record<string, string>)[key] ?? key}
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
      </box>
      <box border={["top"]} borderColor={theme.border} paddingTop={1} flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>
          Docs → <span style={{ fg: theme.accent }}>https://navi.ai/docs</span>
        </text>
        <text fg={theme.textMuted}>Press {commandShortcut()} for all actions</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1} paddingTop={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
