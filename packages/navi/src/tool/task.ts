import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect, Exit, Schema } from "effect"
import { SessionStatus } from "@/session/status"

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
    const statusSvc = yield* SessionStatus.Service

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

      // Check messages of nextSession to see if we've already prompted it with this prompt
      const msgs = yield* sessions.messages({ sessionID: nextSession.id })
      const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
      const lastUserText = lastUserMsg?.parts.findLast((p) => p.type === "text")?.text ?? ""

      const currentStatus = yield* statusSvc.get(nextSession.id)

      if (lastUserMsg && lastUserText === params.prompt) {
        // This is a status check/poll for the existing prompt
        if (currentStatus.type === "busy") {
          return {
            title: params.description,
            metadata: {
              sessionId: nextSession.id,
              model,
            },
            output: [
              `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
              "",
              "Status: running",
              "The subagent is currently still working on the task in the background. Please check back later using the task tool with the same task_id.",
            ].join("\n"),
          }
        } else {
          // If status is idle, it has finished or is not running. Let's get the final result.
          const lastMsg = msgs.findLast((m) => m.info.role === "assistant")
          const textPart = lastMsg?.parts.findLast((p) => p.type === "text")?.text ?? ""
          return {
            title: params.description,
            metadata: {
              sessionId: nextSession.id,
              model,
            },
            output: [
              `task_id: ${nextSession.id}`,
              "",
              "Status: completed",
              "<task_result>",
              textPart,
              "</task_result>",
            ].join("\n"),
          }
        }
      }

      // If we are sending a new/different instruction (or first time)
      if (currentStatus.type === "busy") {
        return {
          title: params.description,
          metadata: {
            sessionId: nextSession.id,
            model,
          },
          output: [
            `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
            "",
            "Status: running",
            "The subagent is currently busy working on a previous task. Please wait until it is finished before sending a new instruction.",
          ].join("\n"),
        }
      }

      const env = yield* Effect.context()

      // Start new prompt execution in the background
      const messageID = MessageID.ascending()
      const runPrompt = Effect.gen(function* () {
        const parts = yield* ops.resolvePromptParts(params.prompt)
        yield* ops.prompt({
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
        })
      }).pipe(
        Effect.catchCause((cause) => {
          // Log subagent failure but don't crash parent
          return Effect.void
        }),
        Effect.provide(env),
      )

      // Fork prompt in the background!
      yield* Effect.forkDetach(runPrompt)

      return {
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
        output: [
          `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
          "",
          "Status: running",
          "The subagent has started the task in the background. You can check the status of this task later by calling this tool again with task_id: \"" + nextSession.id + "\".",
        ].join("\n"),
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
