import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

export function DialogMode() {
    const local = useLocal()
    const dialog = useDialog()

    const options = createMemo(() => {
        return local.agent.list()
            .map((item) => {
                return {
                    value: item.name,
                    title: item.name,
                    description: item.native ? "native" : item.description,
                    category: (item as any).categories?.join(", "),
                }
            })
    })

    return (
        <DialogSelect
            title="Select Mode (Primary Agent)"
            current={local.agent.current().name}
            options={options()}
            onSelect={(option) => {
                local.agent.set(option.value)
                dialog.clear()
            }}
        />
    )
}
