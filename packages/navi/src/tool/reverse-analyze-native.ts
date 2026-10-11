import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import path from "node:path"
import fs from "node:fs"
import { analyzeNativeBinary } from "@/reverse/native"
const DESCRIPTION = "Analyzes native ELF, PE, and Mach-O executable binaries."

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Relative or absolute binary to analyze",
  }),
})

const fmtSymbols = (label: string, items: readonly { name: string; kind: string }[], truncated: boolean): string[] => [
  `## ${label} (${items.length}${truncated ? "+" : ""})`,
  ...(items.length === 0
    ? ["None."]
    : items
        .slice(0, 60)
        .map((s) => `- \`${s.name}\` (${s.kind})`)
        .concat(items.length > 60 ? [`- … ${items.length - 60} more`] : [])),
]

export const ReverseAnalyzeNativeTool = Tool.define(
  "reverse_analyze_native",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          if (!params.path) {
            return {
              title: "Reverse: native binary",
              output: "Pass `path` to a binary file.",
              metadata: {} as Record<string, unknown>,
            }
          }
          const target = path.isAbsolute(params.path) ? params.path : path.resolve(instance.directory, params.path)

          yield* ctx.ask({
            permission: "reverse_analyze_native",
            patterns: [params.path],
            always: ["*"],
            metadata: { path: target },
          })

          if (!fs.existsSync(target)) {
            return {
              title: "Reverse: native binary",
              output: `Target not found: \`${target}\``,
              metadata: { path: target } as Record<string, unknown>,
            }
          }
          const result = analyzeNativeBinary(fs.readFileSync(target))
          const name = path.basename(target)
          const lines = [
            `# Reverse: native \`${name}\``,
            "",
            `Format: ${result.format}, arch: ${result.architecture}, kind: ${result.kind}`,
            ...(result.entry ? [`Entry: ${result.entry}`] : []),
            ...(result.interpreter ? [`Interpreter: \`${result.interpreter}\``] : []),
            ...(result.needed.length > 0 ? [`Linked: ${result.needed.slice(0, 30).join(", ")}${result.needed.length > 30 ? " …" : ""}`] : []),
            "",
            ...fmtSymbols("Imports", result.imports, result.importTruncated),
            "",
            ...fmtSymbols("Exports", result.exports, result.exportTruncated),
            "",
            "## Notes",
            ...(result.notes.length === 0 ? ["None."] : result.notes.map((n) => `- ${n}`)),
            "",
            "## Unknowns",
            ...(result.unknowns.length === 0
              ? ["None."]
              : result.unknowns.map((u) => `- **${u.kind}**: ${u.message}`)),
          ].join("\n")
          return {
            title: `Reverse native: ${name}`,
            output: lines,
            metadata: { path: target, format: result.format } as Record<string, unknown>,
          }
        }),
    }
  }),
)
