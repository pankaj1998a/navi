import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { RunCommand } from "./run"
import { TuiThreadCommand } from "./tui/thread"

function isInteractiveInvocation(args: { message?: unknown[]; command?: string }) {
  const message = (args.message ?? []).filter((item) => typeof item === "string" && item.trim().length > 0)
  return message.length === 0 && !args.command && process.stdin.isTTY && process.stdout.isTTY
}

export const DebugCommand = cmd({
  command: "debug [message..]",
  describe: "run the debug agent",
  builder: (yargs: Argv) => RunCommand.builder(yargs),
  handler: async (args) => {
    const next = { ...args, agent: "debug", allowSubagent: true }
    if (isInteractiveInvocation(args)) {
      return TuiThreadCommand.handler(next as any)
    }
    return RunCommand.handler(next as any)
  },
})
