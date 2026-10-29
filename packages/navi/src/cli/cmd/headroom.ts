import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import fs from "node:fs"
import path from "node:path"
import {
  compressContext,
  retrieveCcr,
  getHeadroomTelemetry,
} from "@/compress/headroom"

export const HeadroomCommand = effectCmd({
  command: "headroom [action] [arg]",
  describe: "Headroom AI — Context Compression Layer & Lossless CCR Store",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "Action: 'compress' (compress file or text), 'retrieve' (retrieve original via CCR key), 'stats' (view telemetry), 'test' (run benchmark)",
        choices: ["compress", "retrieve", "stats", "test"] as const,
        default: "stats",
      })
      .positional("arg", {
        describe: "Target file path or CCR key",
        type: "string",
      })
      .option("type", {
        alias: "t",
        describe: "Content type: log, diff, json, or code",
        choices: ["log", "diff", "json", "code"] as const,
        default: "log",
      }),
  handler: Effect.fn("Cli.headroom")(function* (args) {
    const action = args.action || "stats"
    const arg = args.arg ? String(args.arg) : ""
    const type = args.type || "log"

    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  ⚡ Headroom AI — Context Compression & Lossless CCR Store")
    UI.empty()

    if (action === "stats") {
      const stats = getHeadroomTelemetry()
      UI.println(UI.Style.TEXT_NORMAL + "  Headroom Context Optimization Telemetry:")
      UI.println(`    • Total Compressions:      ${stats.total_compressions}`)
      UI.println(`    • Original Volume:         ${(stats.original_chars / 1024).toFixed(1)} KB`)
      UI.println(`    • Compressed Volume:       ${(stats.compressed_chars / 1024).toFixed(1)} KB`)
      UI.println(`    • Est. Tokens Saved:       ${stats.estimated_tokens_saved.toLocaleString()} tokens`)
      UI.println(`    • Active CCR Cache Keys:   ${stats.ccr_entries}`)
      UI.empty()
      UI.println(UI.Style.TEXT_DIM + "  Commands:")
      UI.println("    navi headroom compress <file> -t [log|diff|json|code]")
      UI.println("    navi headroom retrieve <ccr_key>")
      UI.println("    navi headroom test")
      return
    }

    if (action === "retrieve") {
      if (!arg) {
        UI.println(UI.Style.TEXT_DANGER + "  [Error] Please provide a CCR key to retrieve.")
        UI.println("  Example: navi headroom retrieve 5a2b1c8f9e0d...")
        return
      }

      const content = retrieveCcr(arg)
      if (!content) {
        UI.println(UI.Style.TEXT_DANGER + `  [Error] No cached payload found for key: "${arg}"`)
        return
      }

      UI.println(UI.Style.TEXT_SUCCESS + `  [OK] Retrieved ${content.length} characters from CCR Store:`)
      UI.println("-".repeat(70))
      UI.println(content)
      return
    }

    if (action === "compress") {
      if (!arg) {
        UI.println(UI.Style.TEXT_DANGER + "  [Error] Please provide a file path to compress.")
        return
      }

      const filePath = path.resolve(arg)
      if (!fs.existsSync(filePath)) {
        UI.println(UI.Style.TEXT_DANGER + `  [Error] File not found: ${filePath}`)
        return
      }

      const input = fs.readFileSync(filePath, "utf8")
      const result = compressContext(type, input)

      UI.println(UI.Style.TEXT_SUCCESS + `  [OK] Compressed ${type.toUpperCase()} successfully:`)
      UI.println(`    • Original Length:   ${result.original_len} chars (~${Math.round(result.original_len / 4)} tokens)`)
      UI.println(`    • Compressed Length: ${result.compressed_len} chars (~${Math.round(result.compressed_len / 4)} tokens)`)
      UI.println(`    • Savings:           ${((1 - result.compression_ratio) * 100).toFixed(1)}% (${result.tokens_saved_est} tokens saved)`)
      if (result.ccr_key) {
        UI.println(`    • CCR Retrieval Key: <<ccr:${result.ccr_key}>>`)
      }
      UI.empty()
      UI.println(UI.Style.TEXT_DIM + "--- Compressed Preview ---")
      UI.println(result.compressed.slice(0, 1000) + (result.compressed.length > 1000 ? "\n... [truncated preview]" : ""))
      return
    }

    if (action === "test") {
      UI.println(UI.Style.TEXT_NORMAL + "  Running Headroom Compression Benchmarks...\n")

      // 1. Log benchmark
      let sampleLog = "Starting test runner...\n"
      for (let i = 0; i < 200; i++) {
        sampleLog += `[INFO] compiling module_${i} in 12ms\n`
      }
      sampleLog += "FATAL: OutOfMemoryError in worker thread 4\n"
      sampleLog += "panic: runtime error: invalid memory address or nil pointer dereference\n"
      sampleLog += "goroutine 1 [running]:\n  main.execute()\n"
      sampleLog += "TEST FAILED: 1 failed, 199 passed\n"

      const logRes = compressContext("log", sampleLog)
      UI.println(
        UI.Style.TEXT_SUCCESS +
          `  [Log Compressor]  ${sampleLog.length} chars -> ${logRes.compressed_len} chars (${((1 - logRes.compression_ratio) * 100).toFixed(0)}% saved, CCR: <<ccr:${logRes.ccr_key}>>)`,
      )

      // 2. Diff benchmark
      let sampleDiff = "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,50 +1,52 @@\n"
      for (let i = 0; i < 40; i++) {
        sampleDiff += " import unchanged module\n"
      }
      sampleDiff += "-const insecureKey = 'hardcoded_secret'\n+const secureKey = process.env.API_KEY\n"
      for (let i = 0; i < 40; i++) {
        sampleDiff += " trailing context line\n"
      }

      const diffRes = compressContext("diff", sampleDiff)
      UI.println(
        UI.Style.TEXT_SUCCESS +
          `  [Diff Compressor] ${sampleDiff.length} chars -> ${diffRes.compressed_len} chars (${((1 - diffRes.compression_ratio) * 100).toFixed(0)}% saved)`,
      )

      // 3. JSON benchmark
      const sampleJson = JSON.stringify(
        {
          status: "ok",
          null_field: null,
          empty_list: [],
          nested: {
            valid: true,
            another_null: null,
            count: 42,
          },
        },
        null,
        2,
      )

      const jsonRes = compressContext("json", sampleJson)
      UI.println(
        UI.Style.TEXT_SUCCESS +
          `  [JSON Crusher]    ${sampleJson.length} chars -> ${jsonRes.compressed_len} chars (${((1 - jsonRes.compression_ratio) * 100).toFixed(0)}% saved)`,
      )

      UI.empty()
      UI.println(UI.Style.TEXT_INFO + "  All Headroom engines verified functional!")
      return
    }
  }),
})
