import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"

export interface TodoItemProps {
  id: string
  status: string
  content: string
  onToggle?: (id: string) => void
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  const handleToggle = () => {
    if (props.onToggle) {
      props.onToggle(props.id)
    }
  }

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        style={{
          fg: props.status === "completed" ? theme.success : props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
        onMouseDown={handleToggle}
      >
        [{props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "}]{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
        attributes={props.status === "completed" ? TextAttributes.STRIKETHROUGH : undefined}
        onMouseDown={handleToggle}
      >
        {props.content}
      </text>
    </box>
  )
}
