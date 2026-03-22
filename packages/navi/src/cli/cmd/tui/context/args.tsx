import { createSimpleContext } from "./helper"

export interface Args {
  model?: string
  agent?: string
  mode?: "plan" | "build"
  prompt?: string
  continue?: boolean
  sessionID?: string
  themeMode?: "dark" | "light"
}

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
  name: "Args",
  init: (props: Args) => props,
})
