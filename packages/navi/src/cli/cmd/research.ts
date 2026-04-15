import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { RunCommand } from "./run"
import { TuiThreadCommand } from "./tui/thread"

function isInteractiveInvocation(args: { message?: unknown[]; command?: string }) {
  const message = (args.message ?? []).filter((item) => typeof item === "string" && item.trim().length > 0)
  return message.length === 0 && !args.command && process.stdin.isTTY && process.stdout.isTTY
}

export const ResearchCommand = cmd({
  command: "research [message..]",
  describe: "run the research agent",
  builder: (yargs: Argv) =>
    RunCommand.builder(yargs).option("auto", {
      describe: "use the iterative autoresearch subagent instead of the researcher orchestrator",
      type: "boolean",
    }),
  handler: async (args) => {
    const agent = args.auto ? "autoresearch" : "researcher"
    const next = { ...args, agent, allowSubagent: true }
    if (isInteractiveInvocation(args)) {
      return TuiThreadCommand.handler(next as any)
    }
    return RunCommand.handler(next as any)
  },
})



