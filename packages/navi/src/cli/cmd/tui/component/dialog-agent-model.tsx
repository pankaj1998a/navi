import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogModel } from "./dialog-model"

export function DialogAgentModel() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()

  const options = createMemo(() =>
    sync.data.agent.filter(a => !a.hidden).map((item) => {
      return {
        value: item.name,
        title: item.name,
        description: item.mode === "subagent" ? "Sub-agent" : "Primary agent",
      }
    }),
  )

  return (
    <DialogSelect
      title="Select agent to configure model"
      options={options()}
      onSelect={(option) => {
        dialog.replace(() => <DialogModel agent={option.value} />)
      }}
    />
  )
}
