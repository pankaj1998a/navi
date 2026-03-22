import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { RGBA } from "@opentui/core"
import { useToast } from "@tui/ui/toast"
import { DialogAgentCreate } from "./dialog-agent-create"
import { Keybind } from "@/util/keybind"
import * as fs from "fs/promises"
import * as path from "path"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { useSDK } from "@tui/context/sdk"
import { reconcile } from "solid-js/store"

export function DialogAgentManager() {
    const sync = useSync()
    const dialog = useDialog()
    const toast = useToast()
    const sdk = useSDK()
    const [toDelete, setToDelete] = createSignal<string>()

    const options = createMemo<DialogSelectOption<string>[]>(() => {
        const agents = sync.data.agent
            .filter(a => !a.native)
            .map(item => {
                const isDeleting = toDelete() === item.name
                return {
                    value: item.name,
                    title: isDeleting ? "Press ctrl+d again to confirm" : item.name,
                    bg: isDeleting ? RGBA.fromHex("#ff0000") : undefined,
                    description: item.description,
                    category: "Custom Agents"
                }
            })

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
            onMove={() => setToDelete(undefined)}
            onSelect={(option) => {
                if (option.value === "$create") {
                    dialog.push(<DialogAgentCreate />)
                    return
                }
            }}
            keybind={[
                {
                    keybind: Keybind.parse("ctrl+d")[0],
                    title: "Delete",
                    onTrigger: async (option) => {
                        if (option.value === "$create") return
                        if (toDelete() === option.value) {
                            try {
                                const agent = sync.data.agent.find(a => a.name === option.value)
                                if (!agent) return

                                // Try project first, then global
                                const projectPath = path.join(Instance.worktree, ".navi/agent", `${agent.name}.md`)
                                const globalPath = path.join(Global.Path.config, "agent", `${agent.name}.md`)

                                let deleted = false
                                try {
                                    await fs.unlink(projectPath)
                                    deleted = true
                                } catch {
                                    try {
                                        await fs.unlink(globalPath)
                                        deleted = true
                                    } catch { }
                                }

                                if (deleted) {
                                    toast.show({ message: `Deleted agent: ${agent.name}`, variant: "success" })
                                    // Force reload
                                    await sdk.client.instance.dispose({})
                                    const agents = await sdk.client.app.agents({})
                                    sync.set("agent", reconcile(agents.data ?? []))
                                } else {
                                    toast.show({ message: "Could not find agent file to delete", variant: "error" })
                                }
                            } catch (e: any) {
                                toast.show({ message: `Failed to delete: ${e.message}`, variant: "error" })
                            }
                            setToDelete(undefined)
                            return
                        }
                        setToDelete(option.value)
                    }
                }
            ]}
        />
    )
}
