import { addons, types } from "storybook/manager-api"
import { ThemeTool } from "./theme-tool"

addons.register("navi/theme-toggle", () => {
  addons.add("navi/theme-toggle/tool", {
    type: types.TOOL,
    title: "Theme",
    match: ({ viewMode }) => viewMode === "story" || viewMode === "docs",
    render: ThemeTool,
  })
})
