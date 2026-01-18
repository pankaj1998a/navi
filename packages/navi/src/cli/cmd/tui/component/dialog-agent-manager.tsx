import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogAgentCreate } from "./dialog-agent-create"

export function DialogAgentManager() {
    const sync = useSync()
    const dialog = useDialog()

    const options = createMemo(() => {
        const agents = sync.data.agent
            .filter(a => !a.native)
            .map(item => ({
                value: item.name,
                title: item.name,
                description: item.description,
                category: "Custom Agents"
            }))

        return [
            {
                value: "$create",
                title: "Create new agent",
                description: "Create a new custom agent from description",
                category: "Actions"
            },
            ...agents
        ]
    })

    return (
        <DialogSelect
            title="Manage Agents"
            options={options()}
            onSelect={(option) => {
                if (option.value === "$create") {
                    dialog.push(<DialogAgentCreate />)
                    return
                }
                // TODO: Implement edit/delete dialog
            }}
        />
    )
}
