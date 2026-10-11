import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import path from "node:path"
import fs from "node:fs"
import { analyzeFirmware } from "@/reverse/firmware"
const DESCRIPTION = "Analyzes firmware images and embedded binaries."

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Relative or absolute firmware image to scan",
  }),
})

export const ReverseAnalyzeFirmwareTool = Tool.define(
  "reverse_analyze_firmware",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          if (!params.path) {
            return {
              title: "Reverse: firmware",
              output: "Pass `path` to a firmware image.",
              metadata: {} as Record<string, unknown>,
            }
          }
          const target = path.isAbsolute(params.path) ? params.path : path.resolve(instance.directory, params.path)

          yield* ctx.ask({
            permission: "reverse_analyze_firmware",
            patterns: [params.path],
            always: ["*"],
            metadata: { path: target },
          })

          if (!fs.existsSync(target)) {
            return {
              title: "Reverse: firmware",
              output: `Target not found: \`${target}\``,
              metadata: { path: target } as Record<string, unknown>,
            }
          }
          const result = analyzeFirmware(fs.readFileSync(target))
          const name = path.basename(target)
          const lines = [
            `# Reverse: firmware \`${name}\``,
            "",
            `Size: ${result.size} bytes, mean entropy ${result.entropyMean}`,
            "",
            `## Regions (${result.regions.length})`,
            ...(result.regions.length === 0
              ? ["None recognized."]
              : result.regions.map((r) => `- \`0x${r.offset.toString(16)}\` ${r.kind}: ${r.detail}`)),
            "",
            `Strings: ${result.strings}`,
            `Keywords: ${result.keywords.join(", ") || "none"}`,
            `Hotspots: ${result.entropyHotspots.map((o) => `\`0x${o.toString(16)}\``).join(", ") || "none"}`,
            "",
            "## Unknowns",
            ...(result.unknowns.length === 0
              ? ["None."]
              : result.unknowns.map((u) => `- **${u.kind}**: ${u.message}`)),
          ].join("\n")
          return {
            title: `Reverse firmware: ${name}`,
            output: lines,
            metadata: { path: target, regions: result.regions.length } as Record<string, unknown>,
          }
        }),
    }
  }),
)
