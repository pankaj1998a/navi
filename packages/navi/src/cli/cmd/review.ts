// CLI entry point for `navi review`.
//
// Collects a diff (uncommitted, against a base ref, or a single commit) and
// runs a headless review session through the same in-process server, session,
// and agent machinery `navi run` uses. Prints the review to stdout; never
// requires a TTY so it can run in CI.
import { Effect } from "effect"
import { EOL } from "os"
import path from "path"
import { createNaviClient, type NaviClient } from "@navi-ai/sdk/v2"
import { Agent } from "../../agent/agent"
import { Permission } from "../../permission"
import { collectDiff, errorText, finalText, resolveDiffTarget, resolveTarget, type DiffTarget } from "../automation"
import { CliError, effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"

type ModelInput = Parameters<NaviClient["session"]["prompt"]>[0]["model"]

function pick(value: string | undefined): ModelInput | undefined {
  if (!value) return undefined
  const [providerID, ...rest] = value.split("/")
  return {
    providerID,
    modelID: rest.join("/"),
  } as ModelInput
}

function scope(target: DiffTarget): string {
  switch (target.type) {
    case "uncommitted":
      return "the uncommitted working tree changes"
    case "base":
      return `the changes between ${target.ref} and HEAD`
    case "commit":
      return `the changes introduced by commit ${target.sha}`
  }
}

function reviewPrompt(target: DiffTarget, diff: string): string {
  return [
    "You are a meticulous senior code reviewer performing a focused review of one change set.",
    "",
    "Review the diff at the end of this message for:",
    "- Correctness bugs and edge cases (null/undefined, error handling, concurrency)",
    "- Security issues (injection, secrets, unsafe input, path traversal)",
    "- Performance problems and unnecessary work",
    "- Regressions in behavior or public API, and missing test coverage",
    "",
    "Report only findings you can support from the diff. Do not restate the code.",
    "For each finding use this shape: [P0-P3] file:line - issue - concrete fix.",
    "If the change looks correct, say so and note any residual risks.",
    "",
    `Scope: ${scope(target)}.`,
    "",
    "<diff>",
    diff,
    "</diff>",
  ].join("\n")
}

export const ReviewCommand = effectCmd({
  command: "review",
  describe: "review code changes with a headless agent session",
  builder: (yargs) =>
    yargs
      .option("uncommitted", {
        type: "boolean",
        describe: "review uncommitted changes (default when no ref is given)",
      })
      .option("base", {
        type: "string",
        describe: "review changes against this ref (git diff <ref>...HEAD)",
      })
      .option("commit", {
        type: "string",
        describe: "review a single commit (git show <sha>)",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("output-last-message", {
        type: "string",
        describe: "write the review text to a file",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"] as const,
        default: "default",
        describe: "format: default (review text) or json ({ sessionID, target, text })",
      }),
  handler: Effect.fn("Cli.review")(function* (args) {
    const resolved = resolveDiffTarget({
      base: args.base,
      commit: args.commit,
      uncommitted: args.uncommitted,
    })
    if (!resolved.ok) return yield* fail(resolved.error)
    // Resolve refs to full commit ids so reports never echo `HEAD` or an
    // abbreviated id, and invalid refs fail before any session is created.
    const resolution = yield* Effect.tryPromise({
      try: () => resolveTarget({ target: resolved.target, cwd: process.cwd() }),
      catch: (error) =>
        new CliError({
          message: `Failed to resolve review target: ${errorText(error)}`,
        }),
    })
    if (!resolution.ok) return yield* fail(resolution.error)
    const target = resolution.target
    const outputLastMessage = args["output-last-message"]

    const diff = yield* Effect.tryPromise({
      try: () => collectDiff({ target, cwd: process.cwd() }),
      catch: (error) =>
        new CliError({
          message: `Failed to collect diff: ${errorText(error)}`,
        }),
    })
    if (!diff.trim()) {
      process.stdout.write("No changes to review." + EOL)
      return
    }

    const agentSvc = yield* Agent.Service
    const requested = args.agent
    const resolveAgent = Effect.fnUntraced(function* (name: string) {
      const entry = yield* agentSvc.get(name)
      if (!entry) {
        UI.println(
          UI.Style.TEXT_WARNING_BOLD + "!",
          UI.Style.TEXT_NORMAL,
          `agent "${name}" not found. Falling back to default agent`,
        )
        return undefined
      }
      if (entry.mode === "subagent") {
        UI.println(
          UI.Style.TEXT_WARNING_BOLD + "!",
          UI.Style.TEXT_NORMAL,
          `agent "${name}" is a subagent, not a primary agent. Falling back to default agent`,
        )
        return undefined
      }
      return name
    })
    const agent = requested ? yield* resolveAgent(requested) : undefined

    const directory = process.cwd()
    // SDK v2 calls fetch.preconnect at runtime, so it must exist on the delegated fetch.
    const fetchFn: typeof fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
        const { Server } = await import("../../server/server")
        const request = new Request(input, init)
        return await Server.Default().app.fetch(request)
      },
      { preconnect: globalThis.fetch.preconnect.bind(globalThis.fetch) },
    )
    const sdk = createNaviClient({
      baseUrl: "http://navi.internal",
      fetch: fetchFn,
      directory,
    })

    const rules: Permission.Ruleset = [
      { permission: "question", action: "deny", pattern: "*" },
      { permission: "plan_enter", action: "deny", pattern: "*" },
      { permission: "plan_exit", action: "deny", pattern: "*" },
    ]

    const created = yield* Effect.tryPromise({
      try: () => sdk.session.create({ title: `Review: ${scope(target)}`, permission: rules }),
      catch: (error) =>
        new CliError({
          message: `Failed to create review session: ${errorText(error)}`,
        }),
    })
    const sessionID = created.data?.id
    if (!sessionID) {
      return yield* fail(
        created.error ? `Failed to create review session: ${errorText(created.error)}` : "Failed to create review session",
      )
    }

    const events = yield* Effect.tryPromise({
      try: () => sdk.event.subscribe(),
      catch: (error) =>
        new CliError({
          message: `Failed to subscribe to session events: ${errorText(error)}`,
        }),
    })

    let sessionError: string | undefined
    void (async () => {
      for await (const event of events.stream) {
        if (event.type === "session.error") {
          const props = event.properties
          if (props.sessionID !== sessionID || !props.error) continue
          let err = String(props.error.name)
          if ("data" in props.error && props.error.data && "message" in props.error.data) {
            err = String(props.error.data.message)
          }
          sessionError = err
          UI.error(err)
        }
        if (
          event.type === "session.status" &&
          event.properties.sessionID === sessionID &&
          event.properties.status.type === "idle"
        ) {
          break
        }
        if (event.type === "permission.asked") {
          if (event.properties.sessionID !== sessionID) continue
          await sdk.permission.reply({ requestID: event.properties.id, reply: "reject" })
        }
      }
    })().catch(() => {})

    const result = yield* Effect.tryPromise({
      try: () =>
        sdk.session.prompt({
          sessionID,
          agent,
          model: pick(args.model),
          parts: [{ type: "text", text: reviewPrompt(target, diff) }],
        }),
      catch: (error) =>
        new CliError({
          message: `Review failed: ${errorText(error)}`,
        }),
    })

    if (result.error) return yield* fail(`Review failed: ${errorText(result.error)}`)
    const text = finalText(result.data)
    const printable = args.format === "json" ? JSON.stringify({ sessionID, target, text }) : text.trimEnd()
    if (printable) process.stdout.write(printable + EOL)

    if (outputLastMessage && text.trim()) {
      yield* Effect.tryPromise({
        try: () => Bun.write(path.resolve(directory, outputLastMessage), text),
        catch: (error) =>
          new CliError({
            message: `Failed to write ${outputLastMessage}: ${errorText(error)}`,
          }),
      })
    }

    if (!text.trim()) return yield* fail("Review completed without output")
    if (sessionError) return yield* fail(sessionError)
  }),
})
