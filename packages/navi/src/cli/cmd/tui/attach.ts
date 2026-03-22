import { cmd } from "../cmd"
import { tui } from "./app"

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running navi server",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("theme-mode", {
        type: "string",
        choices: ["dark", "light"],
        describe: "force TUI theme mode",
      }),
  handler: async (args) => {
    if (args.dir) process.chdir(args.dir)
    await tui({
      url: args.url,
      args: {
        sessionID: args.session,
        themeMode: args["theme-mode"] as "dark" | "light",
      },
      directory: process.cwd(),
    })
  },
})
