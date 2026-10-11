import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import path from "node:path"
import fs from "node:fs"
import { analyzeJavascriptApplication } from "@/reverse/javascript"
const DESCRIPTION = "Analyzes obfuscated JavaScript and WebAssembly bundles."

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Relative or absolute directory or file to analyze (defaults to workspace root)",
  }),
  maxFiles: Schema.optional(Schema.Number).annotate({
    description: "Maximum files to parse before reporting partial results (default 200)",
  }),
})

export const ReverseAnalyzeJavascriptTool = Tool.define(
  "reverse_analyze_javascript",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const target = params.path
            ? path.isAbsolute(params.path)
              ? params.path
              : path.resolve(instance.directory, params.path)
            : instance.directory

          yield* ctx.ask({
            permission: "reverse_analyze_javascript",
            patterns: [params.path ?? "*"],
            always: ["*"],
            metadata: { path: target },
          })

          if (!fs.existsSync(target)) {
            return {
              title: "Reverse: JavaScript application",
              output: `Target not found: \`${target}\``,
              metadata: { path: target } as Record<string, unknown>,
            }
          }

          const maxFiles = params.maxFiles ?? 200
          const result = analyzeJavascriptApplication(target, maxFiles)
          const rel = path.relative(instance.worktree, result.root) || "root"
          const lines = [
            `# Reverse: JavaScript application \`${rel}\``,
            "",
            result.packageName ? `Package: \`${result.packageName}\`` : "Package: unknown (no package.json)",
            result.electronMain ? `Electron main: \`${result.electronMain}\`` : "Electron main: unknown",
            `Modules observed: ${result.modules.length}${result.truncated ? " (partial)" : ""}`,
            "",
            "## Modules",
            "| Module | Lines | Digest | Imports | Exports |",
            "| :--- | ---: | :--- | :--- | :--- |",
            ...result.modules.slice(0, 80).map((m) => {
              const imports = m.imports.slice(0, 5).join(", ") || "—"
              const exports = m.exports.slice(0, 5).join(", ") || "—"
              return `| \`${m.path}\` | ${m.lines} | \`${m.digest}\` | ${imports} | ${exports} |`
            }),
            ...(result.modules.length > 80 ? [`| … ${result.modules.length - 80} more | | | | |`] : []),
            "",
            "## Unknowns",
            ...(result.unknowns.length === 0
              ? ["None. All reported facts are observed with digests."]
              : result.unknowns.map((u) => `- **${u.kind}**: ${u.message}${u.path ? ` (\`${u.path}\`)` : ""}`)),
          ].join("\n")

          return {
            title: `Reverse JS: ${rel}`,
            output: lines,
            metadata: {
              root: result.root,
              modulesCount: result.modules.length,
              unknownsCount: result.unknowns.length,
              truncated: result.truncated,
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)
