import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import path from "node:path"
import fs from "node:fs"
import { analyzeHar, analyzeSourceMap } from "@/reverse/web"
const DESCRIPTION = "Analyzes web client bundles, source maps, and network assets."

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Relative or absolute .har or .map file",
  }),
  kind: Schema.Literals(["auto", "har", "sourcemap"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("auto" as const)))
    .annotate({
      description: "Capture kind: 'auto' (default), 'har', or 'sourcemap'",
    }),
})

export const ReverseAnalyzeWebTool = Tool.define(
  "reverse_analyze_web",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          if (!params.path) {
            return {
              title: "Reverse: web capture",
              output: "Pass `path` to a .har or .map file.",
              metadata: {} as Record<string, unknown>,
            }
          }
          const target = path.isAbsolute(params.path) ? params.path : path.resolve(instance.directory, params.path)

          yield* ctx.ask({
            permission: "reverse_analyze_web",
            patterns: [params.path],
            always: ["*"],
            metadata: { path: target },
          })

          if (!fs.existsSync(target)) {
            return {
              title: "Reverse: web capture",
              output: `Target not found: \`${target}\``,
              metadata: { path: target } as Record<string, unknown>,
            }
          }
          const text = fs.readFileSync(target, "utf-8")
          const name = path.basename(target)
          const kind =
            params.kind !== "auto"
              ? params.kind
              : target.endsWith(".har")
                ? "har"
                : text.includes('"mappings"') && text.includes('"sources"')
                  ? "sourcemap"
                  : "har"
          if (kind === "sourcemap") {
            const result = analyzeSourceMap(text)
            const s = result.sourcemap
            const lines = [
              `# Reverse: source map \`${name}\``,
              "",
              ...(s
                ? [
                    `Sources: ${s.sources} (${s.sourcesWithContent} with content), names: ${s.names}`,
                    `Mappings: ${s.mappingsBytes} bytes over ${s.generatedLines} generated lines`,
                    ...(s.file ? [`File: \`${s.file}\``] : []),
                  ]
                : ["Unreadable."]),
              "",
              "## Unknowns",
              ...(result.unknowns.length === 0
                ? ["None."]
                : result.unknowns.map((u) => `- **${u.kind}**: ${u.message}`)),
            ].join("\n")
            return {
              title: `Reverse sourcemap: ${name}`,
              output: lines,
              metadata: { path: target, kind } as Record<string, unknown>,
            }
          }
          const result = analyzeHar(text)
          const h = result.har
          const lines = [
            `# Reverse: HAR \`${name}\``,
            "",
            ...(h
              ? [
                  `Version: ${h.version}, entries: ${h.entries}, bytes: ${h.totalBytes}`,
                  `Statuses: ${h.statuses.map((s) => `${s.name}×${s.count}`).join(", ") || "none"}`,
                  `Top mimes: ${h.mimes.slice(0, 6).map((s) => `${s.name}×${s.count}`).join(", ") || "none"}`,
                  `Top domains: ${h.domains.slice(0, 8).map((s) => `${s.name}×${s.count}`).join(", ") || "none"}`,
                  "",
                  "## Largest bodies",
                  ...(h.largest.length === 0 ? ["None."] : h.largest.map((l) => `- ${l.bytes} bytes \`${l.url}\``)),
                  "",
                  "## Failures",
                  ...(h.failures.length === 0 ? ["None."] : h.failures.map((f) => `- ${f.status} \`${f.url}\``)),
                ]
              : ["Unreadable."]),
            "",
            "## Unknowns",
            ...(result.unknowns.length === 0
              ? ["None."]
              : result.unknowns.map((u) => `- **${u.kind}**: ${u.message}`)),
          ].join("\n")
          return {
            title: `Reverse HAR: ${name}`,
            output: lines,
            metadata: { path: target, kind } as Record<string, unknown>,
          }
        }),
    }
  }),
)
