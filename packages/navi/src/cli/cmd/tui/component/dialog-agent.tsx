import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogModel } from "./dialog-model"
import { updatePreferences, loadPreferences } from "@/config/preferences"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  // Open with xlarge size so the box is wide enough, and set size immediately
  // so the wrapping Dialog box doesn't constrain the list height.
  dialog.setSize("xlarge")

  const options = createMemo(() =>
    local.agent
      .list()
      .filter((item) => item.name.toLowerCase() !== "ralph")
      .map((item) => {
        const prefs = loadPreferences()
        const savedModel = prefs.agentModels?.[item.name]
        return {
          value: item.name,
          title: item.name,
          description: savedModel
            ? `${item.native ? "native" : item.description} · model: ${savedModel}`
            : item.native
              ? "native"
              : item.description,
        }
      }),
  )

  // After selecting an agent, open model picker so user can optionally change the model.
  // The model choice is persisted to preferences immediately.
  function onAgentSelected(agentName: string) {
    local.agent.set(agentName)

    // Open model selector for this agent — user can press Esc to skip
    dialog.replace(() => (
      <DialogAgentModelPicker
        agentName={agentName}
        onDone={() => dialog.clear()}
      />
    ))
  }

  return (
    <DialogSelect
      title="Select agent  (↑↓ scroll · Enter select · Esc cancel)"
      fullHeight
      current={local.agent.current().name}
      options={options()}
      onSelect={(option) => onAgentSelected(option.value)}
    />
  )
}

/**
 * Second step: after an agent is chosen, let the user optionally pick a model.
 * Selection is saved to preferences immediately so it persists across sessions.
 * Pressing Esc skips model selection and just uses the existing preference.
 */
function DialogAgentModelPicker(props: {
  agentName: string
  onDone: () => void
}) {
  const prefs = loadPreferences()
  const current = prefs.agentModels?.[props.agentName]

  return (
    <DialogModel
      title={`Model for "${props.agentName}"${current ? ` (current: ${current})` : " · Esc to keep existing"}`}
      onSelect={(providerID, modelID) => {
        const modelString = `${providerID}/${modelID}`
        // Persist: deep-merge into agentModels so other agents' choices are preserved
        const existing = loadPreferences()
        updatePreferences({
          agentModels: {
            ...existing.agentModels,
            [props.agentName]: modelString,
          },
        })
        props.onDone()
      }}
    />
  )
}
