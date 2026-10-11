import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import path from "node:path"
import fs from "node:fs"
import { analyzeEvmBytecode } from "@/reverse/evm"
const DESCRIPTION = "Analyzes EVM bytecode, smart contracts, and opcodes."

export const Parameters = Schema.Struct({
  hex: Schema.optional(Schema.String).annotate({
    description: "Inline 0x-prefixed bytecode",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "File holding hex or raw bytecode (used when hex is absent)",
  }),
  encoding: Schema.Literals(["hex", "raw"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("hex" as const)))
    .annotate({
      description: "Carrier encoding: 'hex' (default) or 'raw'",
    }),
})

export const ReverseAnalyzeEvmTool = Tool.define(
  "reverse_analyze_evm",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          let input: Uint8Array | undefined
          let label = "inline"
          if (params.hex) {
            input = Buffer.from(params.hex, "utf-8")
          } else if (params.path) {
            const target = path.isAbsolute(params.path) ? params.path : path.resolve(instance.directory, params.path)

            yield* ctx.ask({
              permission: "reverse_analyze_evm",
              patterns: [params.path],
              always: ["*"],
              metadata: { path: target },
            })

            if (!fs.existsSync(target)) {
              return {
                title: "Reverse: EVM",
                output: `Target not found: \`${target}\``,
                metadata: { path: target } as Record<string, unknown>,
              }
            }
            input = new Uint8Array(fs.readFileSync(target))
            label = path.basename(target)
          } else {
            return {
              title: "Reverse: EVM",
              output: "Pass `hex` or `path`.",
              metadata: {} as Record<string, unknown>,
            }
          }
          const result = analyzeEvmBytecode(input, params.encoding ?? "hex")
          const lines = [
            `# Reverse: EVM bytecode \`${label}\``,
            "",
            `Bytes: ${result.bytes}`,
            `Payable: ${result.payable}`,
            ...(result.metadata ? [`Metadata: ${result.metadata}`] : []),
            ...(result.solc ? [`Solc: ${result.solc}`] : []),
            "",
            `## Selectors (${result.selectors.length})`,
            ...(result.selectors.length === 0 ? ["None found."] : result.selectors.map((s) => `- \`0x${s}\``)),
            "",
            "## Unknowns",
            ...(result.unknowns.length === 0
              ? ["None."]
              : result.unknowns.map((u) => `- **${u.kind}**: ${u.message}`)),
          ].join("\n")
          return {
            title: `Reverse EVM: ${label}`,
            output: lines,
            metadata: { bytes: result.bytes, selectors: result.selectors.length } as Record<string, unknown>,
          }
        }),
    }
  }),
)
