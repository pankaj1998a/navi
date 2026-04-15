import type { Argv } from "yargs"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import path from "path"

export const TeleportCommand = cmd({
  command: "teleport [sessionID]",
  describe: "teleport a session (export with full history and Git context)",
  builder: (yargs: Argv) => {
    return yargs
      .positional("sessionID", {
        describe: "session id to teleport",
        type: "string",
      })
      .option("output", {
        alias: "o",
        type: "string",
        describe: "output file path (defaults to session-id.navi)",
      })
  },
  handler: async (args: any) => {
    await bootstrap(process.cwd(), async () => {
      let sessionID = args.sessionID

      if (!sessionID) {
        UI.empty()
        prompts.intro("Teleport session", {
          output: process.stderr,
        })

        const sessions = []
        for await (const session of Session.list()) {
          sessions.push(session)
        }

        if (sessions.length === 0) {
          prompts.log.error("No sessions found", {
            output: process.stderr,
          })
          prompts.outro("Done", {
            output: process.stderr,
          })
          return
        }

        sessions.sort((a, b) => b.time.updated - a.time.updated)

        const selectedSession = await prompts.autocomplete({
          message: "Select session to teleport",
          maxItems: 10,
          options: sessions.map((session) => ({
            label: session.title,
            value: session.id,
            hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
          })),
          output: process.stderr,
        })

        if (prompts.isCancel(selectedSession)) {
          throw new UI.CancelledError()
        }

        sessionID = selectedSession as string
      }

      try {
        prompts.log.step("Gathering session data and VCS context...", {
          output: process.stderr,
        })
        
        const teleportData = await Session.serialize(sessionID!)
        const outputFile = args.output || `${sessionID}.navi`
        
        await Bun.write(outputFile, JSON.stringify(teleportData, null, 2))

        prompts.log.success(`Teleport package created: ${outputFile}`, {
          output: process.stderr,
        })
        
        prompts.log.info("You can now move this file to another machine and use `navi import` to resume.", {
          output: process.stderr,
        })

        prompts.outro("Safe travels!", {
          output: process.stderr,
        })
      } catch (error) {
        UI.error(`Teleport failed: ${(error as Error).message}`)
        process.exit(1)
      }
    })
  },
})



