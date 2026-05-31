import { createMemo } from "solid-js"
import { useKV } from "../context/kv"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { Buddy } from "@/buddy"
import { Locale } from "@/util/locale"

export function DialogBuddy() {
  const kv = useKV()
  const dialog = useDialog()

  const options = createMemo(() =>
    Buddy.SPECIES.map((species) => {
      return {
        value: species,
        title: Locale.titlecase(species),
        description: `Choose the ${species} mascot`,
      }
    }),
  )

  return (
    <DialogSelect
      title="Select Buddy"
      current={kv.get("buddy_species", "")}
      options={options()}
      onSelect={(option) => {
        kv.set("buddy_species", option.value)
        dialog.clear()
      }}
    />
  )
}
