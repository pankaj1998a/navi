import type { ParsedKey, RGBA, CliRenderer } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import type { TuiConfig } from "@/config/tui"
import type { NaviClient } from "@navi-ai/sdk/v2"

export type { RGBA }

export type TuiDispose = () => void | Promise<void>

export interface TuiRoute {
  name: string
  params?: Record<string, any>
}

export interface TuiRouteDefinition {
  name: string
  render: (data: any) => JSX.Element
}

export interface TuiDialogSelectOption<Value = string> {
  title: string
  value: Value
  description?: string
  footer?: string
  category?: string
  disabled?: boolean
  onSelect?: () => void
}

export type SlotMode = "append" | "replace" | "prepend"

export interface TuiSlotContext {
  theme: TuiThemeCurrent
}

export interface TuiSlotMap {
  [key: string]: any
}

export interface TuiPluginMeta {
  id: string
  spec: string
  source: string
  target: string
}

export interface TuiPluginStatus {
  id: string
  spec: string
  source: string
  target: string
  enabled: boolean
  active: boolean
}

export interface TuiPluginInstallResult {
  ok: boolean
  message?: string
  missing?: boolean
  dir?: string
  tui?: boolean
}

export interface TuiTheme {
  name: string
  mode: "dark" | "light"
  colors: TuiThemeCurrent
}

export interface TuiPluginApi {
  app: {
    readonly version: string
  }
  command: {
    register(cb: () => void): TuiDispose
    trigger(command: string): void
  }
  route: {
    register(list: TuiRouteDefinition[]): TuiDispose
    navigate(name: string, params?: Record<string, any>): void
    readonly current: TuiRoute
  }
  ui: {
    Dialog(props: { size?: "sm" | "md" | "lg" | "full"; onClose?: () => void; children: JSX.Element }): JSX.Element
    DialogAlert(props: { title: string; message: string; onConfirm?: () => void }): JSX.Element
    DialogConfirm(props: { title: string; message: string; onConfirm: () => void; onCancel?: () => void }): JSX.Element
    DialogPrompt(props: { title: string; message: string; description?: string; placeholder?: string; onSubmit: (value: string) => void; onCancel?: () => void }): JSX.Element
    DialogSelect<Value = string>(props: {
      title: string
      placeholder?: string
      options: TuiDialogSelectOption<Value>[]
      flat?: boolean
      onMove?: (option: TuiDialogSelectOption<Value>) => void
      onFilter?: (text: string) => void
      onSelect: (option: TuiDialogSelectOption<Value>) => void
      skipFilter?: boolean
      current?: Value
    }): JSX.Element
    Prompt(props: {
      workspaceID?: string
      visible?: boolean
      disabled?: boolean
      onSubmit?: (text: string) => void
      hint?: string
      showPlaceholder?: boolean
      placeholders?: string[]
    }): JSX.Element
    toast(props: { title?: string; message: string; variant?: "info" | "success" | "warning" | "error"; duration?: number }): void
    dialog: {
      replace(render: () => JSX.Element, onClose?: () => void): void
      clear(): void
      setSize(size: "sm" | "md" | "lg" | "full"): void
      readonly size: "sm" | "md" | "lg" | "full"
      readonly depth: number
      readonly open: boolean
    }
  }
  keybind: {
    match(key: string, evt: ParsedKey): boolean
    print(key: string): string
    create(defaults: Record<string, string>, overrides?: Record<string, string>): any
  }
  readonly tuiConfig: TuiConfig.Info
  kv: {
    get<T>(key: string, fallback: T): Promise<T>
    set<T>(key: string, value: T): Promise<void>
    readonly ready: boolean
  }
  state: {
    readonly ready: boolean
    readonly config: any
    readonly provider: any
    readonly path: {
      directory?: string
      worktree?: string
      config?: string
    }
    readonly vcs?: {
      branch?: string
    }
    workspace: {
      list(): string[]
      get(workspaceID: string): any
    }
    session: {
      count(): number
      diff(sessionID: string): any[]
      todo(sessionID: string): any[]
      messages(sessionID: string): any[]
      status(sessionID: string): any
      permission(sessionID: string): any[]
      question(sessionID: string): any[]
    }
    part(messageID: string): any[]
    lsp(): { id: string; root: string; status: any }[]
    mcp(): { name: string; status: any; error?: string }[]
  }
  readonly client: NaviClient
  scopedClient(workspaceID?: string): NaviClient
  workspace: {
    current(): string | undefined
    set(workspaceID: string | undefined): void
  }
  event: {
    on(type: string, handler: (event: any) => void): TuiDispose
  }
  renderer: CliRenderer
  slots: {
    register(plugin: { id?: string; slots: Record<string, (props: any) => JSX.Element> }): string
  }
  plugins: {
    list(): TuiPluginStatus[]
    activate(id: string): Promise<boolean>
    deactivate(id: string): Promise<boolean>
    add(spec: string): Promise<boolean>
    install(spec: string, global?: boolean): Promise<TuiPluginInstallResult>
  }
  lifecycle: {
    readonly signal: AbortSignal
    onDispose(fn: () => void): TuiDispose
  }
  theme: {
    readonly current: TuiThemeCurrent
    readonly selected: string
    has(name: string): boolean
    set(name: string): void
    install(jsonPath: string): Promise<void>
    mode(): "dark" | "light"
    readonly ready: boolean
  }
}

export type TuiPlugin = (api: TuiPluginApi, options?: any, meta?: TuiPluginMeta) => void | Promise<void>

export interface TuiPluginModule {
  id?: string
  tui: TuiPlugin
}

export type TuiThemeCurrent = {
  text: RGBA
  textSubtle: RGBA
  textMuted: RGBA
  textActive: RGBA
  textInverted: RGBA
  primary: RGBA
  primarySubtle: RGBA
  primaryActive: RGBA
  success: RGBA
  warning: RGBA
  error: RGBA
  info: RGBA
  background: RGBA
  backgroundSubtle: RGBA
  backgroundPanel: RGBA
  backgroundElement: RGBA
  backgroundMenu: RGBA
  borderSubtle: RGBA
  border: RGBA
  borderActive: RGBA
  diffAdded: RGBA
  diffRemoved: RGBA
  diffContext: RGBA
  diffHunkHeader: RGBA
  diffHighlightAdded: RGBA
  diffHighlightRemoved: RGBA
  diffAddedBg: RGBA
  diffRemovedBg: RGBA
  diffContextBg: RGBA
  diffLineNumber: RGBA
  diffAddedLineNumberBg: RGBA
  diffRemovedLineNumberBg: RGBA
  markdownText: RGBA
  markdownHeading: RGBA
  markdownLink: RGBA
  markdownLinkText: RGBA
  markdownCode: RGBA
  markdownBlockQuote: RGBA
  markdownEmph: RGBA
  markdownStrong: RGBA
  markdownHorizontalRule: RGBA
  markdownListItem: RGBA
  markdownListEnumeration: RGBA
  markdownImage: RGBA
  markdownImageText: RGBA
  markdownCodeBlock: RGBA
  syntaxComment: RGBA
  syntaxKeyword: RGBA
  syntaxFunction: RGBA
  syntaxVariable: RGBA
  syntaxString: RGBA
  syntaxNumber: RGBA
  syntaxType: RGBA
  syntaxOperator: RGBA
  syntaxPunctuation: RGBA
  thinkingOpacity: number
}
