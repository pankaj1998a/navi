import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import path from "node:path"
import fs from "node:fs"
import { analyzeAppleBundle } from "@/reverse/apple"
const DESCRIPTION = "Analyzes Apple iOS and macOS Mach-O bundles, frameworks, and dylibs."

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Relative or absolute .app bundle, .plist, or Info.plist",
  }),
})

export const ReverseAnalyzeAppleTool = Tool.define(
  "reverse_analyze_apple",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          if (!params.path) {
            return {
              title: "Reverse: Apple bundle",
              output: "Pass `path` to a .app bundle or .plist file.",
              metadata: {} as Record<string, unknown>,
            }
          }
          const target = path.isAbsolute(params.path) ? params.path : path.resolve(instance.directory, params.path)

          yield* ctx.ask({
            permission: "reverse_analyze_apple",
            patterns: [params.path],
            always: ["*"],
            metadata: { path: target },
          })

          if (!fs.existsSync(target)) {
            return {
              title: "Reverse: Apple bundle",
              output: `Target not found: \`${target}\``,
              metadata: { path: target } as Record<string, unknown>,
            }
          }
          const result = analyzeAppleBundle(target)
          const name = path.basename(target)
          const b = result.bundle
          const lines = [
            `# Reverse: Apple \`${name}\``,
            "",
            `Plist: ${result.plistFormat}`,
            ...(b
              ? [
                  `Identifier: \`${b.identifier ?? "unknown"}\``,
                  `Name: ${b.name ?? "unknown"}, version ${b.shortVersion ?? "?"} (${b.version ?? "?"})`,
                  `Executable: ${b.executable ?? "unknown"}${b.executableArch ? ` (${b.executableArch}, ${b.executableKind})` : ""}`,
                  `Frameworks: ${b.frameworks.join(", ") || "none"}`,
                  `PlugIns: ${b.plugins.join(", ") || "none"}`,
                  `Code signed: ${b.codeSigned ? "yes" : "no"}, provisioning: ${b.provisioning ? "yes" : "no"}`,
                ]
              : ["Bundle: unreadable"]),
            "",
            "## Unknowns",
            ...(result.unknowns.length === 0
              ? ["None."]
              : result.unknowns.map((u) => `- **${u.kind}**: ${u.message}`)),
          ].join("\n")
          return {
            title: `Reverse Apple: ${name}`,
            output: lines,
            metadata: { path: target, plist: result.plistFormat } as Record<string, unknown>,
          }
        }),
    }
  }),
)
