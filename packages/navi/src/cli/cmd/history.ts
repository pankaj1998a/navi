import path from "path"
import { readFile } from "fs/promises"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Global } from "../../global"
import { UI } from "../ui"

type HistoryEntry = {
  input: string
  mode?: "normal" | "shell"
  parts: unknown[]
}

function historyFilePath() {
  return path.join(Global.Path.state, "prompt-history.jsonl")
}

function parseHistoryLine(line: string): HistoryEntry | undefined {
  try {
    const parsed = JSON.parse(line) as HistoryEntry
    if (typeof parsed.input !== "string") return undefined
    if (parsed.mode && parsed.mode !== "normal" && parsed.mode !== "shell") return undefined
    if (!Array.isArray(parsed.parts)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

async function loadHistory(): Promise<HistoryEntry[]> {
  const text = await readFile(historyFilePath(), "utf-8").catch(() => "")
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseHistoryLine)
    .filter((entry): entry is HistoryEntry => Boolean(entry))
}

function preview(input: string) {
  const trimmed = input.replace(/\s+/g, " ").trim()
  return trimmed.length > 80 ? trimmed.slice(0, 77) + "..." : trimmed
}

export const HistoryCommand = cmd({
  command: "history",
  describe: "inspect recent prompt history",
  builder: (yargs: Argv) =>
    yargs
      .option("count", {
        alias: "n",
        type: "number",
        describe: "limit to N most recent prompts",
      })
      .option("json", {
        type: "boolean",
        describe: "output raw JSON",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const history = await loadHistory()
      const limited = args.count ? history.slice(-args.count) : history

      if (limited.length === 0) {
        UI.println(UI.Style.TEXT_WARNING + "No prompt history found")
        return
      }

      if (args.json) {
        console.log(JSON.stringify(limited, null, 2))
        return
      }

      UI.println(UI.Style.TEXT_INFO_BOLD + `Prompt History (${limited.length})`)
      UI.println(UI.Style.TEXT_DIM + "Use the TUI prompt history keybinds to cycle older prompts.")
      UI.println("")
      limited.forEach((entry, index) => {
        UI.println(
          UI.Style.TEXT_NORMAL_BOLD +
            `[${index}] ` +
            UI.Style.RESET +
            `${entry.mode ?? "normal"} · ${preview(entry.input)}`,
        )
      })
    })
  },
})



