import { useTheme } from "../context/theme"
import { feedbackColor, resolveSemantic } from "../theme/semantic"

export type WorkspaceStatus = "connected" | "connecting" | "disconnected" | "error"

export function WorkspaceLabel(props: { type: string; name: string; status?: WorkspaceStatus; icon?: boolean }) {
  const { theme } = useTheme()
  const semantic = () => resolveSemantic(theme)
  const color = () => {
    if (props.status === "connected") return feedbackColor(theme, "success")
    if (props.status === "error") return feedbackColor(theme, "error")
    return semantic().text.muted
  }

  return (
    <>
      {props.icon ? <span style={{ fg: color() }}>● </span> : undefined}
      <span style={{ fg: semantic().text.base }}>{props.name}</span> <span style={{ fg: semantic().text.muted }}>({props.type})</span>
    </>
  )
}
