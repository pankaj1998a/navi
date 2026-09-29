import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Cause, Effect, Exit, Schema, Semaphore } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { Git } from "@/git"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  cancelChildren(parentID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts, any>
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
  timeout_seconds: Schema.optional(Schema.Number).annotate({
    description: "Optional maximum runtime for this subagent task in seconds (aborts subagent if exceeded)",
  }),
  max_steps: Schema.optional(Schema.Number).annotate({
    description: "Optional maximum turns/steps for the subagent execution loop",
  }),
  isolate: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to run this task in non-destructive isolated mode",
  }),
  fail_fast: Schema.optional(Schema.Boolean).annotate({
    description: "If true, immediately abort sibling tasks under the parent session upon failure (defaults to true for data errors)",
  }),
  format: Schema.optional(Schema.Literals(["text", "json"])).annotate({
    description: "Preferred return format for the subagent result ('text' or 'json')",
  }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const git = yield* Git.Service
    const subagentSemaphore = yield* Semaphore.make(2)

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const startTime = Date.now()
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

      const depth = parent.parentID ? 2 : 1

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
              depth,
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

      // Determine whether this subagent is strictly read-only
      const isReadOnly =
        !next.permission.some(
          (rule) =>
            ["edit", "write", "patch", "apply_patch"].includes(rule.permission) &&
            rule.action === "allow",
        ) ||
        next.permission.some(
          (rule) =>
            ["edit", "write", "patch", "apply_patch"].includes(rule.permission) &&
            rule.action === "deny",
        )

      // Only perform git stashing if the subagent can mutate files and wasn't requested in isolated mode
      const shouldStash = !isReadOnly && !params.isolate

      const gitHasChanges = shouldStash
        ? yield* Effect.gen(function* () {
            if (!(yield* git.hasHead(cwd))) return false
            const status = yield* git.status(cwd)
            return status.length > 0
          }).pipe(Effect.catch(() => Effect.succeed(false)))
        : false

      const stashName = `navi-pre-task-${nextSession.id}`
      let stashed = false
      if (gitHasChanges) {
        const stashResult = yield* git.run(["stash", "push", "--include-untracked", "-m", stashName], { cwd })
        stashed = stashResult.exitCode === 0
      }

      const timeoutController = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      if (params.timeout_seconds && params.timeout_seconds > 0) {
        timer = setTimeout(() => {
          timeoutController.abort()
        }, params.timeout_seconds * 1000)
      }

      function onTimeoutAbort() {
        runCancel.fork(cancel)
      }

      const executeTask = Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
          timeoutController.signal.addEventListener("abort", onTimeoutAbort)
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
            let resultParts: MessageV2.Part[] = []

            if (Exit.isFailure(resultExit)) {
              status = "failed"
              const err = Cause.squash(resultExit.cause)
              const errMsg = err instanceof Error ? err.message : String(err)

              let category = "tool_failure"
              const lower = errMsg.toLowerCase()
              if (
                lower.includes("json") ||
                lower.includes("parse") ||
                lower.includes("schema") ||
                lower.includes("validation") ||
                lower.includes("syntax") ||
                lower.includes("invalid data") ||
                lower.includes("data error") ||
                lower.includes("database") ||
                lower.includes("corrupt")
              ) {
                category = "data_error"
              } else if (lower.includes("rate limit") || lower.includes("too many requests")) {
                category = "rate_limit"
              } else if (lower.includes("abort") || lower.includes("cancel") || timeoutController.signal.aborted) {
                category = "aborted"
                status = "aborted"
              } else if (lower.includes("context window") || lower.includes("context overflow")) {
                category = "context_overflow"
              }

              error = { category, message: errMsg }
              textOutput = `Subagent task failed with error: ${errMsg}`
            } else {
              const result = resultExit.value
              resultParts = result.parts
              textOutput = result.parts.findLast((item) => item.type === "text")?.text ?? ""
              const info = result.info
              if (info.role === "assistant" && info.error) {
                status = "failed"
                const errMsg = (info.error as any).data?.message || info.error.name || "Unknown error"
                const lower = errMsg.toLowerCase()
                let category = "tool_failure"
                if (
                  lower.includes("json") ||
                  lower.includes("parse") ||
                  lower.includes("schema") ||
                  lower.includes("validation") ||
                  lower.includes("syntax") ||
                  lower.includes("invalid data") ||
                  lower.includes("data error")
                ) {
                  category = "data_error"
                }
                error = {
                  category,
                  message: errMsg,
                }
              }
            }

            const durationMs = Date.now() - startTime

            // Collect execution telemetry from child parts
            const toolStats: Record<string, number> = {}
            const touchedFiles = new Set<string>()
            for (const part of resultParts) {
              if (part.type === "tool") {
                const toolName = (part as any).tool ?? "unknown"
                toolStats[toolName] = (toolStats[toolName] ?? 0) + 1
                const toolInput = (part as any).state?.input
                if (toolInput && typeof toolInput === "object") {
                  if (typeof toolInput.path === "string") touchedFiles.add(toolInput.path)
                  if (typeof toolInput.filePath === "string") touchedFiles.add(toolInput.filePath)
                  if (typeof toolInput.file === "string") touchedFiles.add(toolInput.file)
                  if (Array.isArray(toolInput.files)) {
                    for (const f of toolInput.files) if (typeof f === "string") touchedFiles.add(f)
                  }
                }
              }
            }

            // Release references to heavy parts array so GC can reclaim prompt buffers immediately
            resultParts = []

            // Immediately update tool metadata so the parent session processor, UI, and event stream reflect status in real time
            yield* ctx.metadata({
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
                status,
                durationMs,
                toolsUsed: toolStats,
                filesTouched: Array.from(touchedFiles),
                ...(error ? { error } : {}),
              },
            })

            // If subagent failed with a data error or fail_fast was enabled, immediately cancel sibling tasks under parent session
            if (status === "failed" && (error?.category === "data_error" || params.fail_fast !== false)) {
              yield* ops.cancelChildren(ctx.sessionID).pipe(Effect.ignore)
            }

            if (params.format === "json") {
              return {
                title: params.description,
                metadata: {
                  sessionId: nextSession.id,
                  model,
                  status,
                  durationMs,
                  toolsUsed: toolStats,
                  filesTouched: Array.from(touchedFiles),
                  ...(error ? { error } : {}),
                },
                output: JSON.stringify(
                  {
                    task_id: nextSession.id,
                    status,
                    duration_ms: durationMs,
                    tools_used: toolStats,
                    files_touched: Array.from(touchedFiles),
                    error,
                    result: textOutput,
                  },
                  null,
                  2,
                ),
              }
            }

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
                status,
                durationMs,
                toolsUsed: toolStats,
                filesTouched: Array.from(touchedFiles),
                ...(error ? { error } : {}),
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                `status: ${status}`,
                `duration: ${(durationMs / 1000).toFixed(2)}s`,
                ...(Object.keys(toolStats).length > 0
                  ? [`tools_used: ${Object.entries(toolStats).map(([k, v]) => `${k} (${v})`).join(", ")}`]
                  : []),
                ...(touchedFiles.size > 0
                  ? [`files_referenced: ${Array.from(touchedFiles).join(", ")}`]
                  : []),
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
            }
            if (stashed) {
              yield* git.run(["stash", "pop"], { cwd }).pipe(Effect.ignore)
            }
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (timer) clearTimeout(timer)
                ctx.abort.removeEventListener("abort", onAbort)
                timeoutController.signal.removeEventListener("abort", onTimeoutAbort)
              }),
            ),
          ),
      )

      return yield* subagentSemaphore.withPermit(executeTask)
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
