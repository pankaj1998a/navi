import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import path from "node:path"
import fs from "node:fs"
import { analyzeApk } from "@/reverse/apk"
const DESCRIPTION = "Analyzes Android APK packages, manifests, and DEX bytecode."

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Relative or absolute .apk to analyze",
  }),
  maxEntries: Schema.optional(Schema.Number).annotate({
    description: "Maximum zip entries to inventory (default 4000)",
  }),
})

export const ReverseAnalyzeApkTool = Tool.define(
  "reverse_analyze_apk",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          if (!params.path) {
            return {
              title: "Reverse: APK",
              output: "Pass `path` to an .apk file.",
              metadata: {} as Record<string, unknown>,
            }
          }
          const target = path.isAbsolute(params.path) ? params.path : path.resolve(instance.directory, params.path)

          yield* ctx.ask({
            permission: "reverse_analyze_apk",
            patterns: [params.path],
            always: ["*"],
            metadata: { path: target },
          })

          if (!fs.existsSync(target)) {
            return {
              title: "Reverse: APK",
              output: `Target not found: \`${target}\``,
              metadata: { path: target } as Record<string, unknown>,
            }
          }
          const result = analyzeApk(fs.readFileSync(target), params.maxEntries ?? 4000)
          const name = path.basename(target)
          const totalMethods = result.dex.reduce((n, d) => n + d.methods, 0)
          const lines = [
            `# Reverse: APK \`${name}\``,
            "",
            `Entries: ${result.entries}${result.truncated ? " (partial)" : ""}`,
            ...(result.manifest
              ? [
                  `Package: \`${result.manifest.package}\``,
                  `Version: ${result.manifest.versionName ?? "?"} (${result.manifest.versionCode ?? "?"})`,
                  `SDK: min ${result.manifest.minSdk ?? "?"} / target ${result.manifest.targetSdk ?? "?"}`,
                  `Debuggable: ${result.manifest.debuggable === true ? "YES" : "no"}`,
                  `Permissions (${result.manifest.permissions.length}): ${result.manifest.permissions.slice(0, 20).join(", ") || "none"}${result.manifest.permissions.length > 20 ? " …" : ""}`,
                ]
              : ["Manifest: unreadable"]),
            `Dex files: ${result.dex.length} (${totalMethods} methods)`,
            ...result.dex.map((d) => `- \`${d.name}\` v${d.version}: ${d.classes} classes, ${d.methods} methods`),
            `Signatures: ${result.signatures.join(", ") || "none detected"}`,
            "",
            "## Largest entries",
            ...result.files
              .filter((f) => !f.name.endsWith("/"))
              .toSorted((a, b) => b.size - a.size)
              .slice(0, 15)
              .map((f) => `- \`${f.name}\` ${f.size} bytes (${f.method})`),
            "",
            "## Unknowns",
            ...(result.unknowns.length === 0
              ? ["None."]
              : result.unknowns.map((u) => `- **${u.kind}**: ${u.message}`)),
          ].join("\n")
          return {
            title: `Reverse APK: ${name}`,
            output: lines,
            metadata: {
              path: target,
              entries: result.entries,
              dexMethods: totalMethods,
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)
