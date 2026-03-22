import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogAgentManager } from "./dialog-agent-manager"
import { DialogModel } from "./dialog-model"
import { Keybind } from "@/util/keybind"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() => {
    const list = local.agent.subagents()
      .map((item) => {
        const m = local.model.getForAgent(item.name)
        return {
          value: item.name,
          title: item.name,
          description: item.native ? "native" : item.description,
          category: (item as any).categories?.join(", "),
          footer: m ? `${m.modelID}` : undefined,
        }
      })

    list.push({
      value: "$manage",
      title: "Manage Agents...",
      description: "Create, edit, or delete agents",
      category: undefined,
      footer: undefined,
    })

    return list
  })

  return (
    <DialogSelect
      title="Select Agent (Subagent/Tool)"
      current={local.agent.current().name}
      options={options()}
      keybind={[
        {
          keybind: Keybind.parse("ctrl+m")[0],
          title: "Set Model",
          onTrigger: (option) => {
            if (option.value === "$manage") return
            dialog.push(<DialogModel agentName={option.value} />)
          },
        },
      ]}
      onSelect={(option) => {
        if (option.value === "$manage") {
          dialog.push(<DialogAgentManager />)
          return
        }
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
