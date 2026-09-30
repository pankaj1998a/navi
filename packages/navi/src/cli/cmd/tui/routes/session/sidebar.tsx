import { useProject } from "@tui/context/project"
import { useSync } from "@tui/context/sync"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { InstallationChannel, InstallationVersion } from "@navi-ai/core/installation/version"
import { TuiPluginRuntime } from "@/cli/cmd/tui/plugin/runtime"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"

export function Sidebar(props: { sessionID?: string; overlay?: boolean }) {
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const session = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={42}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      position={props.overlay ? "absolute" : "relative"}
    >
      <scrollbox
        flexGrow={1}
        scrollAcceleration={scrollAcceleration()}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.background,
            foregroundColor: theme.borderActive,
          },
        }}
      >
        <box flexShrink={0} gap={1} paddingRight={1}>
          <Show
            when={session()}
            fallback={
              <box paddingRight={1}>
                <text fg={theme.text}>
                  <b>Navi</b>
                </text>
                <text fg={theme.textMuted}>Ready to code</text>
              </box>
            }
          >
            {(s) => (
              <TuiPluginRuntime.Slot
                name="sidebar_title"
                mode="single_winner"
                session_id={props.sessionID ?? ""}
                title={s().title}
                share_url={s().share?.url}
              >
                <box paddingRight={1}>
                  <text fg={theme.text}>
                    <b>{s().title}</b>
                  </text>
                  <Show when={InstallationChannel !== "latest"}>
                    <text fg={theme.textMuted}>{props.sessionID}</text>
                  </Show>
                  <Show when={s().workspaceID}>
                    <text fg={theme.textMuted}>
                      <Show
                        when={workspace()}
                        fallback={<WorkspaceLabel type="unknown" name={s().workspaceID!} status="error" icon />}
                      >
                        {(item) => (
                          <WorkspaceLabel
                            type={item().type}
                            name={item().name}
                            status={project.workspace.status(item().id) ?? "error"}
                            icon
                          />
                        )}
                      </Show>
                    </text>
                  </Show>
                  <Show when={s().share?.url}>
                    <text fg={theme.textMuted}>{s().share!.url}</text>
                  </Show>
                </box>
              </TuiPluginRuntime.Slot>
            )}
          </Show>
          <TuiPluginRuntime.Slot name="sidebar_content" session_id={props.sessionID ?? ""} />
        </box>
      </scrollbox>

      <box flexShrink={0} gap={1} paddingTop={1}>
        <TuiPluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID ?? ""}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>Navi</b> <span>{InstallationVersion}</span>
          </text>
        </TuiPluginRuntime.Slot>
      </box>
    </box>
  )
}
