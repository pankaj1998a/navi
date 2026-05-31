import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createSignal, onMount, Show } from "solid-js"
import { Logo } from "../component/logo"
import { useProject } from "../context/project"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { TuiPluginRuntime } from "@/cli/cmd/tui/plugin/runtime"
import { useEditorContext } from "@tui/context/editor"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "../context/theme"
import { createMemo } from "solid-js"
import { useKV } from "../context/kv"
import { useTerminalDimensions } from "@opentui/solid"
import { Sidebar } from "./session/sidebar"
import { useBindings } from "../keymap"

let once = false
const placeholder = {
  normal: ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"],
  shell: ["ls -la", "git status", "pwd"],
}

export function Home() {
  const sync = useSync()
  const project = useProject()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const editor = useEditorContext()
  const { theme } = useTheme()
  const highlight = createMemo(() => {
    const agent = local.agent.current()
    if (!agent) return theme.border
    return local.agent.color(agent.name)
  })
  const borderHighlight = createMemo(() => highlight())
  const kv = useKV()
  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })

  useBindings(() => ({
    priority: 100,
    commands: [
      {
        name: "session.sidebar.toggle",
        title: sidebarVisible() ? "Hide sidebar" : "Show sidebar",
        category: "Session",
        run: () => {
          const isVisible = sidebarVisible()
          setSidebar(() => (isVisible ? "hide" : "auto"))
          setSidebarOpen(!isVisible)
        },
      },
    ],
    bindings: [
      {
        command: "session.sidebar.toggle",
        sequence: ["C-x", "b"],
      },
    ],
  }))
  let sent = false

  onMount(() => {
    editor.clearSelection()
  })

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (route.prompt) {
      r.set(route.prompt)
      once = true
      return
    }
    if (!args.prompt) return
    r.set({ input: args.prompt, parts: [] })
    once = true
  }

  // Wait for sync and model store to be ready before auto-submitting --prompt
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!sync.ready || !local.model.ready) return
    if (!args.prompt) return
    if (r.current.input !== args.prompt) return
    sent = true
    r.submit()
  })

  return (
    <box flexDirection="row" width="100%" height="100%">
      <Show when={sidebarVisible()}>
        <Sidebar />
      </Show>
      <box flexGrow={1} flexDirection="column" height="100%">
        <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
          <box flexGrow={1} minHeight={0} />
          <box height={4} minHeight={0} flexShrink={1} />
          <box flexShrink={0}>
            <TuiPluginRuntime.Slot name="home_logo" mode="replace">
              <Logo />
            </TuiPluginRuntime.Slot>
          </box>
          <box height={1} minHeight={0} flexShrink={1} />
          <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1} flexShrink={0}>
            <TuiPluginRuntime.Slot
              name="home_prompt"
              mode="replace"
              workspace_id={project.workspace.current()}
              ref={bind}
            >
              <Prompt
                ref={bind}
                workspaceID={project.workspace.current()}
                right={<TuiPluginRuntime.Slot name="home_prompt_right" workspace_id={project.workspace.current()} />}
                placeholders={placeholder}
              />
            </TuiPluginRuntime.Slot>
          </box>
          <TuiPluginRuntime.Slot name="home_bottom" />
          <box flexGrow={1} minHeight={0} />
          <Toast />
        </box>
        <box width="100%" flexShrink={0}>
          <TuiPluginRuntime.Slot name="home_footer" mode="single_winner" />
        </box>
      </box>
    </box>
  )
}
