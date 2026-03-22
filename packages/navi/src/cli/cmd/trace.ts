import type { Argv } from "yargs"
import fs from "fs/promises"
import path from "path"
import { cmd } from "./cmd"
import { Config } from "../../config/config"
import { Global } from "../../global"

type TraceLine = {
  time: number
  sessionID: string
  type: string
  [key: string]: any
}

function formatAge(epochMs: number) {
  const ageMs = Date.now() - epochMs
  if (ageMs < 1000) return `${ageMs}ms ago`
  const seconds = Math.floor(ageMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

async function traceFile(sessionID: string) {
  const config = await Config.get()
  const dir = config.experimental?.sessionTracing?.directory
    ? path.resolve(config.experimental.sessionTracing.directory)
    : path.join(Global.Path.state, "trace")
  return path.join(dir, `${sessionID}.jsonl`)
}

async function readTrace(sessionID: string) {
  const file = await traceFile(sessionID)
  const text = await fs.readFile(file, "utf8").catch(() => "")
  if (!text.trim()) return []
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as TraceLine
      } catch {
        return undefined
      }
    })
    .filter((line): line is TraceLine => Boolean(line))
}

function summarize(lines: TraceLine[]) {
  const turns = lines.filter((line) => line.type === "turn.start" || line.type === "turn.finish")
  const finishes = lines.filter((line) => line.type === "turn.finish")
  const latest = lines[lines.length - 1]
  return {
    lines: lines.length,
    turns: Math.max(0, Math.floor(turns.length / 2)),
    finishes: finishes.length,
    latestAt: latest?.time,
  }
}

export const TraceCommand = cmd({
  command: "trace <sessionID>",
  describe: "inspect and replay session trace events",
  builder: (yargs: Argv) =>
    yargs
      .positional("sessionID", {
        describe: "session id to inspect",
        type: "string",
      })
      .option("json", {
        type: "boolean",
        describe: "output raw trace JSON lines as JSON",
      })
      .option("replay", {
        type: "boolean",
        describe: "render the trace as a replay-friendly turn summary",
      })
      .option("limit", {
        type: "number",
        describe: "limit the number of trace lines rendered",
      }),
  handler: async (args) => {
    const lines = await readTrace(args.sessionID)
    const selected = typeof args.limit === "number" ? lines.slice(-args.limit) : lines

    if (args.json) {
      console.log(JSON.stringify({ sessionID: args.sessionID, summary: summarize(selected), lines: selected }, null, 2))
      return
    }

    const summary = summarize(selected)
    console.log(`Trace: ${args.sessionID}`)
    console.log(`- lines: ${summary.lines}`)
    console.log(`- turns: ${summary.turns}`)
    console.log(`- finish events: ${summary.finishes}`)
    if (summary.latestAt) console.log(`- latest: ${formatAge(summary.latestAt)}`)
    console.log("")

    if (args.replay) {
      for (const line of selected) {
        if (line.type === "turn.start") {
          console.log(
            `[${new Date(line.time).toISOString()}] START ${line.agent} requested=${line.requestedModel} routed=${line.routedModel}`,
          )
          if (line.agentVersion || line.promptHash) {
            console.log(`  version: ${line.agentVersion ?? "unknown"}${line.promptHash ? ` prompt=${line.promptHash}` : ""}`)
          }
          if (Array.isArray(line.reasons) && line.reasons.length) {
            console.log(`  reasons: ${line.reasons.join(" | ")}`)
          }
          continue
        }
        if (line.type === "turn.finish") {
          const parts = [
            `[${new Date(line.time).toISOString()}] FINISH ${line.agent}`,
            line.agentVersion ? `version=${line.agentVersion}` : undefined,
            line.promptHash ? `prompt=${line.promptHash}` : undefined,
            line.finish ? `finish=${line.finish}` : undefined,
            typeof line.cost === "number" ? `cost=${line.cost.toFixed(4)}` : undefined,
            typeof line.toolCalls === "number" ? `tools=${line.toolCalls}` : undefined,
            typeof line.questionCount === "number" ? `questions=${line.questionCount}` : undefined,
            line.error ? `error=${line.error}` : undefined,
          ].filter(Boolean)
          console.log(parts.join(" "))
          if (line.responseKind) console.log(`  response: ${line.responseKind}`)
          if (line.responseBlockedReason) console.log(`  blocked: ${line.responseBlockedReason}`)
          if (line.responseNextStep) console.log(`  next: ${line.responseNextStep}`)
          continue
        }
      }
      return
    }

    for (const line of selected.slice(-20)) {
      console.log(`[${new Date(line.time).toISOString()}] ${line.type}`)
    }
  },
})
