import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@navi-ai/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless navi server",
  // Server loads instances per-request via x-navi-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const opts = yield* resolveNetworkOptions(args)
    // The server route tree (httpapi, sessions, providers, pty) is heavy and is
    // only reachable from this handler — never from `serve --help`.
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    const server = yield* Effect.promise(() => Server.listen(opts))
    if (!server.password) {
      console.log("Warning: authentication disabled; server is unsecured.")
    } else {
      const username = Flag.NAVI_SERVER_USERNAME || process.env.NAVI_SERVER_USERNAME || "navi"
      console.log(`Server authentication enabled (username: ${username}, password: ${server.password})`)
    }
    console.log(`navi server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
