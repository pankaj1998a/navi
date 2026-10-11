import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import path from "path"
import fs from "fs"
import { spawn } from "child_process"

export const StructureCommand = effectCmd({
  command: "structure [target]",
  describe: "Compress TypeScript, Swift, Python, Go, and Rust projects into dense AST symbol maps for LLM agents",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("target", {
        describe: "Directory or repository to analyze (defaults to current directory)",
        type: "string",
      })
      .option("mode", {
        alias: "m",
        describe: "Mapping mode: dense | skeleton | exports | sigs | full",
        type: "string",
        default: "dense",
      })
      .option("out", {
        alias: "o",
        describe: "Output file path (default: project-structure-map.txt)",
        type: "string",
      })
      .option("stdout", {
        describe: "Print the generated symbol map directly to stdout",
        type: "boolean",
        default: false,
      })
      .option("include", {
        describe: "Comma-separated subdirectories to include",
        type: "string",
      })
      .option("include-tests", {
        describe: "Include test files in the symbol map",
        type: "boolean",
        default: false,
      })
      .option("members", {
        describe: "Include container members (Swift)",
        type: "boolean",
        default: false,
      })
      .option("public-only", {
        describe: "Include only public/open declarations",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.structure")(function* (args) {
    const targetDir = path.resolve(args.target || process.cwd())
    const mode = args.mode || "dense"
    const mapScript = path.resolve(import.meta.dir, "../../../skills/project-structure/map.ts")

    if (!fs.existsSync(mapScript)) {
      UI.println(UI.Style.TEXT_DANGER_BOLD + "❌ Error: map.ts script not found at " + mapScript)
      return
    }

    const outFile = args.out ? path.resolve(args.out) : path.join(process.cwd(), "project-structure-map.txt")

    const cliArgs = [mapScript, targetDir, "--mode", mode, "--out", outFile]
    if (args.include) cliArgs.push("--include", args.include)
    if (args["include-tests"]) cliArgs.push("--include-tests")
    if (args.members) cliArgs.push("--members")
    if (args["public-only"]) cliArgs.push("--public-only")

    UI.println(
      UI.Style.TEXT_INFO_BOLD +
        `🔍 Analyzing project structure for ${path.basename(targetDir)} (mode: ${mode})...` +
        UI.Style.TEXT_NORMAL,
    )

    const result = yield* Effect.promise<string>(() =>
      new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, cliArgs, {
          stdio: ["ignore", "pipe", "pipe"],
        })

        let stdout = ""
        let stderr = ""

        proc.stdout.on("data", (d) => (stdout += d.toString()))
        proc.stderr.on("data", (d) => (stderr += d.toString()))

        proc.on("close", (code) => {
          if (code === 0) {
            resolve(stdout)
          } else {
            reject(new Error(stderr || `Mapper process exited with code ${code}`))
          }
        })
      }),
    )

    try {
      const stats = JSON.parse(result.trim().split("\n").pop() || "{}")
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `✓ Symbol map generated:` +
          UI.Style.TEXT_NORMAL +
          ` ${stats.files ?? 0} files, ${stats.symbols ?? 0} symbols (~${stats.approxTokens ?? 0} tokens)`,
      )
      UI.println(UI.Style.TEXT_DIM + `  Output saved to: ${outFile}` + UI.Style.TEXT_NORMAL)
    } catch {
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ Symbol map generated at: ${outFile}` + UI.Style.TEXT_NORMAL)
    }

    if (args.stdout && fs.existsSync(outFile)) {
      const content = fs.readFileSync(outFile, "utf8")
      process.stdout.write("\n" + content + "\n")
    }
  }),
})
