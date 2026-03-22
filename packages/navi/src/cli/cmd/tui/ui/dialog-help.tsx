import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Navi Help
        </text>
        <text fg={theme.textMuted}>esc/enter</text>
      </box>
      <box flexDirection="column" gap={0}>
        <text fg={theme.text}>Core Shortcuts:</text>
        <text fg={theme.textMuted}>- {keybind.print("command_list")}: Command Palette</text>
        <text fg={theme.textMuted}>- {keybind.print("agent_list")}: Switch Mode</text>
        <text fg={theme.textMuted}>- {keybind.print("model_list")}: Switch Model</text>
        <text fg={theme.textMuted}>- {keybind.print("session_list")}: List Sessions</text>
      </box>
      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={theme.text}>GSD Workflow:</text>
        <text fg={theme.textMuted}>1. /map_codebase - Understand the project, symbols, and recent changes</text>
        <text fg={theme.textMuted}>2. /plan_phase - Create a plan</text>
        <text fg={theme.textMuted}>3. /execute_phase - Run the plan</text>
      </box>
      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={theme.text}>Recovery:</text>
        <text fg={theme.textMuted}>- checkpoint create/list/restore: Save and restore project snapshots</text>
        <text fg={theme.textMuted}>- session list: Reopen previous sessions</text>
      </box>
      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={theme.text}>Trace & Eval:</text>
        <text fg={theme.textMuted}>- trace &lt;sessionID&gt; --replay: Inspect and replay session traces</text>
        <text fg={theme.textMuted}>- eval --verification &lt;mode&gt;: Show verification gates for a mode</text>
      </box>
      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={theme.text}>Prompt History:</text>
        <text fg={theme.textMuted}>- {keybind.print("history_previous")} / {keybind.print("history_next")}: Cycle recent prompts</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingTop={1} paddingBottom={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
