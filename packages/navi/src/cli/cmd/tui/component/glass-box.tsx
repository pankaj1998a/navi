import { type ParentProps } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { RGBA } from "@opentui/core"
import { LuxuryBorder } from "./border"

export function GlassBox(props: ParentProps<{
  width?: number | "auto" | `${number}%`
  height?: number | "auto" | `${number}%`
  padding?: number
  gap?: number
  borderColor?: RGBA
  glassAlpha?: number
}>) {
  const { theme } = useTheme()
  const alpha = props.glassAlpha ?? 0.8
  
  const glassBg = () => {
    const bg = theme.backgroundPanel
    return RGBA.fromValues(bg.r, bg.g, bg.b, alpha)
  }

  return (
    <box
      width={props.width}
      height={props.height}
      padding={props.padding ?? 1}
      gap={props.gap}
      backgroundColor={glassBg()}
      border={LuxuryBorder.border}
      borderColor={props.borderColor ?? theme.border}
      customBorderChars={LuxuryBorder.customBorderChars}
    >
      {props.children}
    </box>
  )
}
