import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import { queryBridge, ensureBridgeDaemonRunning } from "@/native/bridge-runner"
import { extractPatchesFromResponse, applyExtractedPatches } from "@/bridge/file-executor"

export const AskCommand = effectCmd({
  command: "ask <prompt..>",
  describe: "Zero-API-key query to logged-in web AI (ChatGPT, Claude, DeepSeek, Gemini) with optional file editing",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("prompt", {
        describe: "The question or prompt to send to the browser AI",
        type: "string",
      })
      .option("provider", {
        alias: "p",
        describe: "Target AI provider (chatgpt, claude, deepseek, gemini, grok, kimi, perplexity)",
        type: "string",
        default: "chatgpt",
      })
      .option("providers", {
        describe: "Comma-separated list of providers to query in parallel (e.g. chatgpt,claude)",
        type: "string",
      })
      .option("apply", {
        alias: "a",
        describe: "Automatically extract and apply code patches/edits to local workspace files",
        type: "boolean",
        default: false,
      })
      .option("timeout", {
        alias: "t",
        describe: "Timeout in seconds",
        type: "number",
        default: 60,
      }),
  handler: Effect.fn("Cli.ask")(function* (args) {
    const prompt = Array.isArray(args.prompt) ? args.prompt.join(" ") : String(args.prompt || "")
    if (!prompt.trim()) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "Please provide a prompt to ask.")
      return
    }

    yield* Effect.promise(() => ensureBridgeDaemonRunning())

    const timeoutSecs = typeof args.timeout === "number" ? args.timeout : 60

    if (args.providers) {
      const provs: string[] = String(args.providers)
        .split(",")
        .map((p: string) => p.trim())
        .filter(Boolean)

      UI.println(UI.Style.TEXT_INFO_BOLD + `Fanning out query across ${provs.length} providers (${provs.join(", ")})...` + UI.Style.TEXT_NORMAL)

      yield* Effect.forEach(
        provs,
        (prov: string) =>
          Effect.gen(function* () {
            try {
              UI.println(UI.Style.TEXT_DIM + `[${prov}] Waiting for response...`)
              const reply = yield* Effect.promise(() => queryBridge(prompt, prov, timeoutSecs))
              UI.println(UI.Style.TEXT_SUCCESS_BOLD + `\n--- [${prov.toUpperCase()}] ---`)
              UI.println(reply)
            } catch (err: any) {
              UI.println(UI.Style.TEXT_DANGER_BOLD + `[${prov}] Error: ` + (err.message || String(err)))
            }
          }),
        { concurrency: "unbounded" },
      )
      return
    }

    const provider = String(args.provider || "chatgpt")
    UI.println(UI.Style.TEXT_INFO + `Asking ${provider}...`)
    try {
      const response = yield* Effect.promise(() => queryBridge(prompt, provider, timeoutSecs))
      UI.println(response)

      // Check if response contains patches or file modifications
      const patches = extractPatchesFromResponse(response)
      if (patches.length > 0) {
        const touchedFiles = Array.from(new Set(patches.flatMap((p) => p.files)))
        UI.println()
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `⚡ Detected ${patches.length} code change(s) for ${touchedFiles.length} file(s):`)
        for (const file of touchedFiles) {
          UI.println(`   • ${file}`)
        }

        if (args.apply) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "Applying changes to workspace...")
          const result = applyExtractedPatches(process.cwd(), patches)
          if (result.success) {
            UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ Successfully applied changes to: ${result.appliedFiles.join(", ")}`)
          } else {
            UI.println(UI.Style.TEXT_DANGER_BOLD + `✗ Failed to apply changes: ${result.error}`)
          }
        } else {
          UI.println(UI.Style.TEXT_DIM + "Tip: Run with `--apply` (or `-a`) to automatically apply these changes to your files.")
        }
      }
    } catch (err: any) {
      UI.println(UI.Style.TEXT_DANGER_BOLD + `Error querying ${provider}: ` + (err.message || String(err)))
      UI.println(UI.Style.TEXT_DIM + "Tip: Run `navi bridge doctor` to check browser tab status.")
    }
  }),
})
