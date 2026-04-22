import { CommandModule } from "yargs"
import { Avni } from "../../agent/avni"
import { UI } from "../ui"
import { Log } from "../../util/log"

const log = Log.create({ service: "cli.vibe" })

const vibe: CommandModule<{}, { goal: string }> = {
  command: "vibe <goal>",
  describe: "Run VibeMode Production Protocol for complex tasks",
  builder: (y) =>
    y.positional("goal", {
      type: "string",
      demandOption: true,
      describe: "The high-level goal or feature to implement",
    }),
  handler: async (args) => {
    const root = process.cwd()
    const avni = new Avni(root)

    UI.empty()
    UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "🚀 Initialising VibeMode Production Protocol..." + UI.Style.RESET)
    UI.empty()

    const stream = avni.run(args.goal)

    for await (const event of stream) {
      switch (event.type) {
        case "status":
          UI.println(UI.Style.TEXT_INFO + "ℹ️ " + UI.Style.RESET + event.message)
          break
        case "progress":
          UI.empty()
          UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + `Phase ${event.phase}: ${event.step.toUpperCase()}` + UI.Style.RESET)
          break
        case "artifact":
          UI.println(UI.Style.TEXT_SUCCESS + "📄 Artifact created: " + UI.Style.RESET + event.path)
          break
        case "gate":
          UI.empty()
          UI.println(UI.Style.TEXT_WARNING_BOLD + `\n🔒 GATE ${event.gate} AWAITING APPROVAL` + UI.Style.RESET)
          UI.println(UI.Style.TEXT_DIM + event.message + UI.Style.RESET)
          break
        case "agent-result":
          if (event.result.success) {
            UI.println(UI.Style.TEXT_SUCCESS + `✅ ${event.agentType} complete.` + UI.Style.RESET)
          } else {
            UI.println(UI.Style.TEXT_DANGER + `❌ ${event.agentType} failed: ` + UI.Style.RESET + event.result.error)
          }
          break
        case "question":
          UI.empty()
          UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "❓ QUESTION:" + UI.Style.RESET)
          UI.println(event.question)
          break
        case "complete":
          UI.empty()
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✨ VIBEMODE COMPLETE!" + UI.Style.RESET)
          UI.println(event.summary)
          UI.empty()
          break
      }
    }
  },
}

export default vibe

