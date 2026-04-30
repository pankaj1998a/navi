import { useSync } from "@tui/context/sync"
import { createMemo, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { Installation } from "@/installation"
import { TuiPluginRuntime } from "../../plugin"
import { GlassBox } from "../../component/glass-box"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const transactions = createMemo(() => sync.data.transactions[props.sessionID] ?? [])

  return (
    <Show when={session()}>
      <box
        width={42}
        height="100%"
        position={props.overlay ? "absolute" : "relative"}
      >
        <GlassBox padding={0} width="100%" height="100%">
        <box
          flexGrow={1}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
        >
          <scrollbox
            flexGrow={1}
            verticalScrollbarOptions={{
              trackOptions: {
                backgroundColor: theme.background,
                foregroundColor: theme.borderActive,
              },
            }}
          >
            <box flexShrink={0} gap={1} paddingRight={1}>
              <TuiPluginRuntime.Slot
                name="sidebar_title"
                mode="single_winner"
                session_id={props.sessionID}
                title={session()!.title}
                share_url={session()!.share?.url}
              >
                <box paddingRight={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>{session()!.title}</text>
                  <Show when={session()!.share?.url}>
                    <text fg={theme.textMuted}>{session()!.share!.url}</text>
                  </Show>
                </box>
              </TuiPluginRuntime.Slot>
              <TuiPluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
              
              <Show when={transactions().length > 0}>
                <box marginTop={2} gap={1}>
                  <text fg={theme.accent} attributes={TextAttributes.BOLD}>TRANSACTIONS</text>
                  <box gap={0}>
                    <for each={transactions().slice(-10)}>
                      {(t: any) => (
                        <box flexDirection="row" gap={1}>
                          <text fg={t.status === 'committed' ? theme.diffAdded : t.status === 'rolled_back' ? theme.diffRemoved : theme.accent}>
                            {t.status === 'committed' ? '✓' : t.status === 'rolled_back' ? '✗' : '●'}
                          </text>
                          <text fg={theme.textMuted} truncate={true}>{t.taskId.split('-')[0]}</text>
                        </box>
                      )}
                    </for>
                  </box>
                </box>
              </Show>
            </box>
          </scrollbox>

          <box flexShrink={0} gap={1} paddingTop={1}>
            <TuiPluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>Navi</text>
                <text fg={theme.textMuted}>v{Installation.VERSION}</text>
              </box>
            </TuiPluginRuntime.Slot>
          </box>
        </box>
        </GlassBox>
      </box>
    </Show>
  )
}

