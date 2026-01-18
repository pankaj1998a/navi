export namespace Flag {
  export const NAVI_AUTO_SHARE = truthy("NAVI_AUTO_SHARE")
  export const NAVI_GIT_BASH_PATH = process.env["NAVI_GIT_BASH_PATH"] || process.env["navi_GIT_BASH_PATH"]
  export const NAVI_CONFIG = process.env["NAVI_CONFIG"] || process.env["navi_CONFIG"]
  export const NAVI_CONFIG_DIR = process.env["NAVI_CONFIG_DIR"] || process.env["navi_CONFIG_DIR"]
  export const NAVI_CONFIG_CONTENT = process.env["NAVI_CONFIG_CONTENT"] || process.env["navi_CONFIG_CONTENT"]
  export const NAVI_DISABLE_AUTOUPDATE = truthy("NAVI_DISABLE_AUTOUPDATE")
  export const NAVI_DISABLE_PRUNE = truthy("NAVI_DISABLE_PRUNE")
  export const NAVI_DISABLE_TERMINAL_TITLE = truthy("NAVI_DISABLE_TERMINAL_TITLE")
  export const NAVI_PERMISSION = process.env["NAVI_PERMISSION"] || process.env["navi_PERMISSION"]
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
  export const NAVI_FAKE_VCS = process.env["NAVI_FAKE_VCS"] || process.env["navi_FAKE_VCS"]
  export const NAVI_CLIENT = process.env["NAVI_CLIENT"] || process.env["navi_CLIENT"] || "cli"
  export const NAVI_SERVER_PASSWORD = process.env["NAVI_SERVER_PASSWORD"] || process.env["navi_SERVER_PASSWORD"]
  export const NAVI_SERVER_USERNAME = process.env["NAVI_SERVER_USERNAME"] || process.env["navi_SERVER_USERNAME"]

  // Experimental
  export const NAVI_EXPERIMENTAL = truthy("NAVI_EXPERIMENTAL")
  export const NAVI_EXPERIMENTAL_FILEWATCHER = truthy("NAVI_EXPERIMENTAL_FILEWATCHER")
  export const NAVI_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("NAVI_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const NAVI_EXPERIMENTAL_ICON_DISCOVERY =
    NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_ICON_DISCOVERY")
  export const NAVI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthy("NAVI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const NAVI_ENABLE_EXA =
    truthy("NAVI_ENABLE_EXA") || NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_EXA")
  export const NAVI_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH = number("NAVI_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH")
  export const NAVI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("NAVI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const NAVI_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("NAVI_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const NAVI_EXPERIMENTAL_OXFMT = NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_OXFMT")
  export const NAVI_EXPERIMENTAL_LSP_TY = truthy("NAVI_EXPERIMENTAL_LSP_TY")
  export const NAVI_EXPERIMENTAL_LSP_TOOL = NAVI_EXPERIMENTAL || truthy("NAVI_EXPERIMENTAL_LSP_TOOL")
  export const NAVI_MAX_BUDGET_USD = number("NAVI_MAX_BUDGET_USD")
  export const NAVI_MAX_TURNS = number("NAVI_MAX_TURNS")

  function truthy(key: string) {
    // Check NAVI_ first
    let value = process.env[key]?.toLowerCase()
    if (value === "true" || value === "1") return true

    // Fallback to navi_
    const legacyKey = key.replace("NAVI_", "navi_")
    value = process.env[legacyKey]?.toLowerCase()
    return value === "true" || value === "1"
  }

  function number(key: string) {
    // Check NAVI_ first
    let value = process.env[key]
    if (!value) {
      // Fallback to navi_
      const legacyKey = key.replace("NAVI_", "navi_")
      value = process.env[legacyKey]
    }

    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}
