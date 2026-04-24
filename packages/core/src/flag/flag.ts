import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const NAVI_AUTO_SHARE = truthy("NAVI_AUTO_SHARE")
  export const NAVI_GIT_BASH_PATH = process.env["NAVI_GIT_BASH_PATH"]
  export const NAVI_CONFIG = process.env["NAVI_CONFIG"]
  export declare const NAVI_PURE: boolean
  export declare const NAVI_TUI_CONFIG: string | undefined
  export declare const NAVI_CONFIG_DIR: string | undefined
  export declare const NAVI_PLUGIN_META_FILE: string | undefined
  export const NAVI_CONFIG_CONTENT = process.env["NAVI_CONFIG_CONTENT"]
  export const NAVI_DISABLE_AUTOUPDATE = truthy("NAVI_DISABLE_AUTOUPDATE")
  export const NAVI_ALWAYS_NOTIFY_UPDATE = truthy("NAVI_ALWAYS_NOTIFY_UPDATE")
  export const NAVI_DISABLE_PRUNE = truthy("NAVI_DISABLE_PRUNE")
  export const NAVI_DISABLE_TERMINAL_TITLE = truthy("NAVI_DISABLE_TERMINAL_TITLE")
  export const NAVI_SHOW_TTFD = truthy("NAVI_SHOW_TTFD")
  export const NAVI_PERMISSION = process.env["NAVI_PERMISSION"]
  export const NAVI_DISABLE_DEFAULT_PLUGINS = truthy("NAVI_DISABLE_DEFAULT_PLUGINS")
  export const NAVI_DISABLE_LSP_DOWNLOAD = truthy("NAVI_DISABLE_LSP_DOWNLOAD")
  export const NAVI_ENABLE_EXPERIMENTAL_MODELS = truthy("NAVI_ENABLE_EXPERIMENTAL_MODELS")
  export const NAVI_DISABLE_AUTOCOMPACT = truthy("NAVI_DISABLE_AUTOCOMPACT")
  export const NAVI_DISABLE_MODELS_FETCH = truthy("NAVI_DISABLE_MODELS_FETCH")
  export const NAVI_DISABLE_CLAUDE_CODE = truthy("NAVI_DISABLE_CLAUDE_CODE")
  export const NAVI_DISABLE_CLAUDE_CODE_PROMPT =
    NAVI_DISABLE_CLAUDE_CODE || truthy("NAVI_DISABLE_CLAUDE_CODE_PROMPT")
  export const NAVI_DISABLE_CLAUDE_CODE_SKILLS =
    NAVI_DISABLE_CLAUDE_CODE || truthy("NAVI_DISABLE_CLAUDE_CODE_SKILLS")
  export const NAVI_DISABLE_EXTERNAL_SKILLS =
    NAVI_DISABLE_CLAUDE_CODE_SKILLS || truthy("NAVI_DISABLE_EXTERNAL_SKILLS")
  export declare const NAVI_DISABLE_PROJECT_CONFIG: boolean
  export const NAVI_FAKE_VCS = process.env["NAVI_FAKE_VCS"]
  export declare const NAVI_CLIENT: string
  export const NAVI_SERVER_PASSWORD = process.env["NAVI_SERVER_PASSWORD"]
  export const NAVI_SERVER_USERNAME = process.env["NAVI_SERVER_USERNAME"]
  export const NAVI_ENABLE_QUESTION_TOOL = truthy("NAVI_ENABLE_QUESTION_TOOL")

  // Experimental
  export const NAVI_EXPERIMENTAL = truthy("NAVI_EXPERIMENTAL")
  export const NAVI_EXPERIMENTAL_FILEWATCHER = Config.boolean("NAVI_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )
  export const NAVI_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "NAVI_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))
  export const NAVI_EXPERIMENTAL_ICON_DISCOVERY =
    NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["NAVI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const NAVI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("NAVI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const NAVI_ENABLE_EXA =
    truthy("NAVI_ENABLE_EXA") || NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_EXA")
  export const NAVI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("NAVI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const NAVI_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("NAVI_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const NAVI_EXPERIMENTAL_OXFMT = NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_OXFMT")
  export const NAVI_EXPERIMENTAL_LSP_TY = truthy("NAVI_EXPERIMENTAL_LSP_TY")
  export const NAVI_EXPERIMENTAL_LSP_TOOL = NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_LSP_TOOL")
  export const NAVI_DISABLE_FILETIME_CHECK = Config.boolean("NAVI_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )
  export const NAVI_EXPERIMENTAL_PLAN_MODE = NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_PLAN_MODE")
  export const NAVI_EXPERIMENTAL_WORKSPACES = NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_WORKSPACES")
  export const NAVI_EXPERIMENTAL_MARKDOWN = !falsy("NAVI_EXPERIMENTAL_MARKDOWN")
  export const NAVI_MODELS_URL = process.env["NAVI_MODELS_URL"]
  export const NAVI_MODELS_PATH = process.env["NAVI_MODELS_PATH"]
  export const NAVI_DISABLE_EMBEDDED_WEB_UI = truthy("NAVI_DISABLE_EMBEDDED_WEB_UI")
  export const NAVI_DB = process.env["NAVI_DB"]
  export const NAVI_DISABLE_CHANNEL_DB = truthy("NAVI_DISABLE_CHANNEL_DB")
  export const NAVI_SKIP_MIGRATIONS = truthy("NAVI_SKIP_MIGRATIONS")
  export const NAVI_STRICT_CONFIG_DEPS = truthy("NAVI_STRICT_CONFIG_DEPS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for NAVI_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "NAVI_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("NAVI_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for NAVI_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "NAVI_TUI_CONFIG", {
  get() {
    return process.env["NAVI_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for NAVI_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "NAVI_CONFIG_DIR", {
  get() {
    return process.env["NAVI_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for NAVI_PURE
// This must be evaluated at access time, not module load time,
// because the CLI can set this flag at runtime
Object.defineProperty(Flag, "NAVI_PURE", {
  get() {
    return truthy("NAVI_PURE")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for NAVI_PLUGIN_META_FILE
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "NAVI_PLUGIN_META_FILE", {
  get() {
    return process.env["NAVI_PLUGIN_META_FILE"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for NAVI_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "NAVI_CLIENT", {
  get() {
    return process.env["NAVI_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})

