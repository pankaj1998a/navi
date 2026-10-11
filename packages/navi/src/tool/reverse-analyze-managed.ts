import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import path from "node:path"
import fs from "node:fs"
import { analyzeManagedAssembly } from "@/reverse/managed"
const DESCRIPTION = "Analyzes managed .NET CLR and Java JVM assemblies."

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Relative or absolute .dll/.exe to analyze",
  }),
})

export const ReverseAnalyzeManagedTool = Tool.define(
  "reverse_analyze_managed",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          if (!params.path) {
            return {
              title: "Reverse: managed assembly",
              output: "Pass `path` to a .dll or .exe file.",
              metadata: {} as Record<string, unknown>,
            }
          }
          const target = path.isAbsolute(params.path) ? params.path : path.resolve(instance.directory, params.path)

          yield* ctx.ask({
            permission: "reverse_analyze_managed",
            patterns: [params.path],
            always: ["*"],
            metadata: { path: target },
          })

          if (!fs.existsSync(target)) {
            return {
              title: "Reverse: managed assembly",
              output: `Target not found: \`${target}\``,
              metadata: { path: target } as Record<string, unknown>,
            }
          }
          const result = analyzeManagedAssembly(fs.readFileSync(target))
          const name = path.basename(target)
          const lines = [
            `# Reverse: managed assembly \`${name}\``,
            "",
            `Managed: ${result.managed ? "yes" : "no"}`,
            `Machine: ${result.layout.architecture} (${result.layout.optionalHeader}, ${result.layout.sections} sections)`,
            ...(result.moduleName ? [`Module: \`${result.moduleName}\``] : []),
            ...(result.assembly
              ? [
                  `Assembly: \`${result.assembly.name}\` ${result.assembly.version} (${result.assembly.culture})`,
                  `Runtime: ${result.assembly.runtimeVersion}`,
                  `Flags: ${result.assembly.flagNames.join(", ") || "none"}`,
                  `Entry: ${result.assembly.entryKind} (token 0x${result.assembly.entryToken.toString(16)})`,
                  `Public key: ${result.assembly.publicKeyPresent ? "present" : "absent"}`,
                  `ReadyToRun: ${result.assembly.readyToRun ? "yes" : "no"}`,
                  ...(result.assembly.targetFramework ? [`Target framework: ${result.assembly.targetFramework}`] : []),
                ]
              : []),
            "",
            "## Metadata tables",
            ...(result.tables.length === 0
              ? ["None decoded."]
              : result.tables.map((t) => `- ${t.table}: ${t.rows}`)),
            "",
            "## Unknowns",
            ...(result.unknowns.length === 0
              ? ["None."]
              : result.unknowns.map((u) => `- **${u.kind}**: ${u.message}`)),
          ].join("\n")
          return {
            title: `Reverse managed: ${name}`,
            output: lines,
            metadata: {
              path: target,
              managed: result.managed,
              tablesCount: result.tables.length,
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)
