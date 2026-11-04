import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import * as Log from "@navi-ai/core/util/log"
import DESCRIPTION from "./bridge.txt"
import { queryBridge, ensureBridgeDaemonRunning } from "@/native/bridge-runner"
import { extractPatchesFromResponse, applyExtractedPatches } from "@/bridge/file-executor"

const log = Log.create({ service: "tool.bridge" })

export const Parameters = Schema.Struct({
  prompt: Schema.String.annotate({
    description: "The prompt or coding task to send to the browser AI model",
  }),
  provider: Schema.optional(
    Schema.Literals(["chatgpt", "claude", "deepseek", "gemini", "grok", "kimi", "perplexity"]),
  ).annotate({
    description: "Target browser AI model (chatgpt, claude, deepseek, gemini, grok, kimi, perplexity). Defaults to chatgpt.",
  }),
  apply: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to automatically extract and apply code edits/patches returned by the model to local workspace files",
  }),
  timeoutSecs: Schema.optional(Schema.Number).annotate({
    description: "Timeout in seconds for the model query (default: 60)",
  }),
})

export const BridgeTool = Tool.define(
  "bridge",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const provider = params.provider ?? "chatgpt"
          const timeout = params.timeoutSecs ?? 60

          yield* ctx.ask({
            permission: "bridge",
            patterns: [provider],
            always: ["*"],
            metadata: {
              provider,
            },
          })

          yield* Effect.promise(() => ensureBridgeDaemonRunning())

          let rawResponse: string
          try {
            rawResponse = yield* Effect.promise(() => queryBridge(params.prompt, provider, timeout))
          } catch (err: unknown) {
            log.error("Bridge query failed", { error: String(err) })
            return {
              title: `Bridge error (${provider})`,
              output: `NaviBridge error: ${err instanceof Error ? err.message : String(err)}. Make sure the Chrome extension is installed and a tab for ${provider} is logged in.`,
              metadata: {
                provider,
                prompt: params.prompt,
              },
            }
          }

          let appliedSummary = ""
          if (params.apply) {
            const patches = extractPatchesFromResponse(rawResponse)
            if (patches.length > 0) {
              const applyResult = applyExtractedPatches(process.cwd(), patches)
              if (applyResult.success) {
                appliedSummary = `\n\n[Successfully applied changes to: ${applyResult.appliedFiles.join(", ")}]`
              } else {
                appliedSummary = `\n\n[Failed to apply changes: ${applyResult.error}]`
              }
            }
          }

          return {
            title: `Bridge response (${provider})`,
            output: `${rawResponse}${appliedSummary}`,
            metadata: {
              provider,
              prompt: params.prompt,
            },
          }
        }),
    }
  }),
)
