import { Config } from "effect"
import { InstallationChannel } from "../installation/version"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

// Channels where new experiments default to ON (unstable / internal users).
// Stable channels (`prod`, `latest`) stay opt-in.
const UNSTABLE_CHANNELS = new Set(["dev", "beta", "local"])
function unstableDefault(key: string) {
  return truthy(key) || (!falsy(key) && UNSTABLE_CHANNELS.has(InstallationChannel))
}

function number(key: string) {
  const value = process.env[key]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const NAVI_EXPERIMENTAL = truthy("NAVI_EXPERIMENTAL")
const NAVI_DISABLE_CLAUDE_CODE = truthy("NAVI_DISABLE_CLAUDE_CODE")
const NAVI_DISABLE_CLAUDE_CODE_SKILLS =
  NAVI_DISABLE_CLAUDE_CODE || truthy("NAVI_DISABLE_CLAUDE_CODE_SKILLS")
const copy = process.env["NAVI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  NAVI_AUTO_SHARE: truthy("NAVI_AUTO_SHARE"),
  NAVI_AUTO_HEAP_SNAPSHOT: truthy("NAVI_AUTO_HEAP_SNAPSHOT"),
  NAVI_GIT_BASH_PATH: process.env["NAVI_GIT_BASH_PATH"],
  NAVI_CONFIG: process.env["NAVI_CONFIG"],
  NAVI_CONFIG_CONTENT: process.env["NAVI_CONFIG_CONTENT"],
  NAVI_DISABLE_AUTOUPDATE: truthy("NAVI_DISABLE_AUTOUPDATE"),
  NAVI_ALWAYS_NOTIFY_UPDATE: truthy("NAVI_ALWAYS_NOTIFY_UPDATE"),
  NAVI_DISABLE_PRUNE: truthy("NAVI_DISABLE_PRUNE"),
  NAVI_DISABLE_TERMINAL_TITLE: truthy("NAVI_DISABLE_TERMINAL_TITLE"),
  NAVI_SHOW_TTFD: truthy("NAVI_SHOW_TTFD"),
  NAVI_PERMISSION: process.env["NAVI_PERMISSION"],
  NAVI_DISABLE_DEFAULT_PLUGINS: truthy("NAVI_DISABLE_DEFAULT_PLUGINS"),
  NAVI_DISABLE_LSP_DOWNLOAD: truthy("NAVI_DISABLE_LSP_DOWNLOAD"),
  NAVI_ENABLE_EXPERIMENTAL_MODELS: truthy("NAVI_ENABLE_EXPERIMENTAL_MODELS"),
  NAVI_DISABLE_AUTOCOMPACT: truthy("NAVI_DISABLE_AUTOCOMPACT"),
  NAVI_DISABLE_MODELS_FETCH: truthy("NAVI_DISABLE_MODELS_FETCH"),
  NAVI_DISABLE_MOUSE: truthy("NAVI_DISABLE_MOUSE"),
  NAVI_DISABLE_CLAUDE_CODE,
  NAVI_DISABLE_CLAUDE_CODE_PROMPT: NAVI_DISABLE_CLAUDE_CODE || truthy("NAVI_DISABLE_CLAUDE_CODE_PROMPT"),
  NAVI_DISABLE_CLAUDE_CODE_SKILLS,
  NAVI_DISABLE_EXTERNAL_SKILLS: truthy("NAVI_DISABLE_EXTERNAL_SKILLS"),
  // Default-on for dev/beta/local; opt-in for stable. Set
  // NAVI_EXPERIMENTAL_CUSTOMIZE_SKILL=false to force off, =true to force on.
  NAVI_EXPERIMENTAL_CUSTOMIZE_SKILL: unstableDefault("NAVI_EXPERIMENTAL_CUSTOMIZE_SKILL"),
  NAVI_FAKE_VCS: process.env["NAVI_FAKE_VCS"],
  NAVI_SERVER_PASSWORD: process.env["NAVI_SERVER_PASSWORD"],
  NAVI_SERVER_USERNAME: process.env["NAVI_SERVER_USERNAME"],
  NAVI_ENABLE_QUESTION_TOOL: truthy("NAVI_ENABLE_QUESTION_TOOL"),

  // Experimental
  NAVI_EXPERIMENTAL,
  NAVI_EXPERIMENTAL_FILEWATCHER: Config.boolean("NAVI_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  NAVI_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("NAVI_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  NAVI_EXPERIMENTAL_ICON_DISCOVERY: NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_ICON_DISCOVERY"),
  NAVI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("NAVI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  NAVI_ENABLE_EXA: truthy("NAVI_ENABLE_EXA") || NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_EXA"),
  NAVI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: number("NAVI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  NAVI_EXPERIMENTAL_OUTPUT_TOKEN_MAX: number("NAVI_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  NAVI_EXPERIMENTAL_OXFMT: NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_OXFMT"),
  NAVI_EXPERIMENTAL_LSP_TY: truthy("NAVI_EXPERIMENTAL_LSP_TY"),
  NAVI_EXPERIMENTAL_LSP_TOOL: NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_LSP_TOOL"),
  NAVI_EXPERIMENTAL_PLAN_MODE: NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_PLAN_MODE"),
  NAVI_EXPERIMENTAL_SCOUT: NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_SCOUT"),
  NAVI_EXPERIMENTAL_MARKDOWN: !falsy("NAVI_EXPERIMENTAL_MARKDOWN"),
  NAVI_ENABLE_PARALLEL: truthy("NAVI_ENABLE_PARALLEL") || truthy("NAVI_EXPERIMENTAL_PARALLEL"),
  NAVI_MODELS_URL: process.env["NAVI_MODELS_URL"],
  NAVI_MODELS_PATH: process.env["NAVI_MODELS_PATH"],
  NAVI_DISABLE_EMBEDDED_WEB_UI: truthy("NAVI_DISABLE_EMBEDDED_WEB_UI"),
  NAVI_DB: process.env["NAVI_DB"],
  NAVI_DISABLE_CHANNEL_DB: truthy("NAVI_DISABLE_CHANNEL_DB"),
  NAVI_SKIP_MIGRATIONS: truthy("NAVI_SKIP_MIGRATIONS"),
  NAVI_STRICT_CONFIG_DEPS: truthy("NAVI_STRICT_CONFIG_DEPS"),

  NAVI_WORKSPACE_ID: process.env["NAVI_WORKSPACE_ID"],
  NAVI_EXPERIMENTAL_WORKSPACES: NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_WORKSPACES"),
  NAVI_EXPERIMENTAL_EVENT_SYSTEM: NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_EVENT_SYSTEM"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get NAVI_DISABLE_PROJECT_CONFIG() {
    return truthy("NAVI_DISABLE_PROJECT_CONFIG")
  },
  get NAVI_TUI_CONFIG() {
    return process.env["NAVI_TUI_CONFIG"]
  },
  get NAVI_CONFIG_DIR() {
    return process.env["NAVI_CONFIG_DIR"]
  },
  get NAVI_PURE() {
    return truthy("NAVI_PURE")
  },
  get NAVI_PLUGIN_META_FILE() {
    return process.env["NAVI_PLUGIN_META_FILE"]
  },
  get NAVI_CLIENT() {
    return process.env["NAVI_CLIENT"] ?? "cli"
  },
}
