import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./vim.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["enable", "disable", "status", "keybind"]).annotate({
    description: "Vim action: enable/disable vim mode, status check, or resolve a key sequence",
  }),
  keys: Schema.optional(Schema.String).annotate({
    description: "Key sequence to resolve (e.g. 'dw', 'ciw', 'gg', ':%s/foo/bar/g') — required for action 'keybind'",
  }),
  mode: Schema.optional(
    Schema.Literals(["normal", "insert", "visual", "visual-line", "visual-block", "command"]),
  ).annotate({ description: "Target vim mode (for enable)" }),
})

const VIM_MOTIONS = ["h", "j", "k", "l", "w", "b", "e", "0", "^", "$", "gg", "G", "f", "F", "t", "T", "%"] as const
const VIM_OPERATORS = ["d", "c", "y", "p", ">", "<", "gc", "gU", "gu"] as const
const VIM_TEXTOBJECTS = ["iw", "aw", 'i"', 'a"', "i'", "a'", "i(", "a(", "i{", "a{", "it", "at", "ip", "ap"] as const

function describeKeys(keys: string): string {
  const all = new Set([...VIM_MOTIONS, ...VIM_OPERATORS, ...VIM_TEXTOBJECTS])
  if (all.has(keys as any)) return `Known binding: ${keys}`
  if (keys.startsWith(":") || keys.startsWith("/")) return `Command/search: ${keys}`
  // simple compound like dw, diw, ciw, yy, dd
  if (/^[dcyg][ia]?[w'"(){}t]$/.test(keys) || ["dd", "yy", "cc"].includes(keys)) return `Compound operator+motion/textObject: ${keys}`
  return `Unknown/partial sequence: ${keys} — see vim.txt for full families`
}

export const VimTool = Tool.define(
  "vim",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "vim",
            patterns: [params.action, params.keys ?? "*"],
            always: ["status", "keybind"],
            metadata: { action: params.action, keys: params.keys },
          })

          switch (params.action) {
            case "enable":
              return {
                title: "Vim mode enabled",
                output: `Vim mode enabled${params.mode ? ` (mode: ${params.mode})` : ""}.\nModes: normal | insert | visual | visual-line | visual-block | command\nMotions: ${VIM_MOTIONS.join(", ")}\nOperators: ${VIM_OPERATORS.join(", ")}\nTextObjects: ${VIM_TEXTOBJECTS.join(", ")}\nStub: no TUI hook active — key handling will be wired to Ink/OpenTUI in full implementation.`,
                metadata: { enabled: true, mode: params.mode ?? "normal" } as Record<string, unknown>,
              }
            case "disable":
              return {
                title: "Vim mode disabled",
                output: "Vim mode disabled. Returned to default keybindings.",
                metadata: { enabled: false } as Record<string, unknown>,
              }
            case "status":
              return {
                title: "Vim status",
                output: [
                  "Vim Mode: stub (disabled by default)",
                  "Available modes: normal, insert, visual, visual-line, visual-block, command",
                  `Motions (${VIM_MOTIONS.length}): ${VIM_MOTIONS.join(", ")}`,
                  `Operators (${VIM_OPERATORS.length}): ${VIM_OPERATORS.join(", ")}`,
                  `TextObjects (${VIM_TEXTOBJECTS.length}): ${VIM_TEXTOBJECTS.join(", ")}`,
                  "Mirrors: src/vim/motions.ts, operators.ts, textObjects.ts, transitions.ts",
                ].join("\n"),
                metadata: { enabled: false } as Record<string, unknown>,
              }
            case "keybind": {
              if (!params.keys) throw new Error("Parameter 'keys' is required for action 'keybind'")
              const desc = describeKeys(params.keys)
              return {
                title: `Vim keybind: ${params.keys}`,
                output: `${desc}\n\nFamilies:\n- motions: h/j/k/l, w/b/e, 0/^/$, gg/G\n- operators: d/c/y, >/<, gc\n- textObjects: iw/aw, i\"/a\", i(/a(, i{/a{, it/at`,
                metadata: { keys: params.keys, description: desc } as Record<string, unknown>,
              }
            }
            default:
              throw new Error(`Unknown vim action: ${params.action}`)
          }
        }).pipe(Effect.orDie),
    }
  }),
)
