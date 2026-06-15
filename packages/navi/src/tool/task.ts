import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Cause, Effect, Exit, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { Git } from "@/git"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  cancelChildren(parentID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const git = yield* Git.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const parent = yield* sessions.get(ctx.sessionID)
      const parentAgent = parent.agent
        ? yield* agent.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...deriveSubagentSessionPermission({
              parentSessionPermission: parent.permission ?? [],
              parentAgent,
              subagent: next,
            }),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))
      const runCancel = yield* EffectBridge.make()

      const messageID = MessageID.ascending()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      const cwd = msg.info.path.cwd

      const gitHasChanges = yield* Effect.gen(function* () {
        if (!(yield* git.hasHead(cwd))) return false
        const status = yield* git.status(cwd)
        return status.length > 0
      }).pipe(Effect.catch(() => Effect.succeed(false)))

      const stashName = `navi-pre-task-${nextSession.id}`
      let stashed = false
      if (gitHasChanges) {
        const stashResult = yield* git.run(["stash", "push", "--include-untracked", "-m", stashName], { cwd })
        stashed = stashResult.exitCode === 0
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const resultExit = yield* Effect.exit(
              ops.prompt({
                messageID,
                sessionID: nextSession.id,
                model: {
                  modelID: model.modelID,
                  providerID: model.providerID,
                },
                agent: next.name,
                tools: {
                  ...(next.permission.some((rule) => rule.permission === "todowrite") ? {} : { todowrite: false }),
                  ...(next.permission.some((rule) => rule.permission === id) ? {} : { task: false }),
                  ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                },
                parts,
              }),
            )

            let status: "success" | "failed" | "aborted" = "success"
            let error: { category: string; message: string } | undefined
            let textOutput = ""

            if (Exit.isFailure(resultExit)) {
              status = "failed"
              const err = Cause.squash(resultExit.cause)
              const errMsg = err instanceof Error ? err.message : String(err)
              
              let category = "tool_failure"
              if (errMsg.toLowerCase().includes("rate limit") || errMsg.toLowerCase().includes("too many requests")) {
                category = "rate_limit"
              } else if (errMsg.toLowerCase().includes("abort") || errMsg.toLowerCase().includes("cancel")) {
                category = "aborted"
                status = "aborted"
              } else if (errMsg.toLowerCase().includes("context window") || errMsg.toLowerCase().includes("context overflow")) {
                category = "context_overflow"
              }

              error = { category, message: errMsg }
              textOutput = `Subagent task failed with error: ${errMsg}`
            } else {
              const result = resultExit.value
              textOutput = result.parts.findLast((item) => item.type === "text")?.text ?? ""
              if (result.info.error) {
                status = "failed"
                error = {
                  category: "tool_failure",
                  message: result.info.error.message || "Unknown error",
                }
              }
            }

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
                status,
                ...(error ? { error } : {}),
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                `status: ${status}`,
                ...(error ? [`error_category: ${error.category}`, `error_message: ${error.message}`] : []),
                "",
                "<task_result>",
                textOutput,
                "</task_result>",
              ].join("\n"),
            }
          }),
        (resource, exit) =>
          Effect.gen(function* () {
            const hasInterrupted = Exit.hasInterrupts(exit)
            let failed = hasInterrupted
            if (!failed && Exit.isSuccess(exit)) {
              const res = exit.value
              if (res.metadata?.status === "failed" || res.metadata?.status === "aborted") {
                failed = true
              }
            }

            if (failed) {
              yield* cancel
              yield* git.run(["reset", "--hard"], { cwd }).pipe(Effect.ignore)
              yield* git.run(["clean", "-fd"], { cwd }).pipe(Effect.ignore)
            }
            if (stashed) {
              yield* git.run(["stash", "pop"], { cwd }).pipe(Effect.ignore)
            }
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
