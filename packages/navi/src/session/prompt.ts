import path from "path"
import os from "os"
import fs from "fs/promises"
import z from "zod"
import { Identifier } from "../id/id"
import { MessageV2 } from "./message-v2"
import { Log } from "../util/log"
import { SessionRevert } from "./revert"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { SessionCompaction } from "./compaction"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { SystemPrompt } from "./system"
import { Plugin } from "../plugin"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { insertReminders } from "./prompt/reminders"
import { defer } from "../util/defer"
import { clone } from "remeda"
import { Flag } from "../flag/flag"
import { ConfigMarkdown } from "../config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@navi-ai/sdk/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import { MemoryManager } from "@/agent/memory-manager"
import { state as promptState } from "./prompt/state"
import { PermissionNext } from "@/permission/next"
import { getPermissionMode, Permission } from "../permission"
import { getThinkingLevel } from "../agent/thinking-levels"
import { SessionStatus } from "./status"
import { iife } from "@/util/iife"
import { AgentRouter } from "@/agent/router"
import { SessionTrace } from "./trace"
import { AgentPolicy } from "@/agent/policy"
import { executeShell } from "./prompt/shell"
import { resolveTools as resolveToolsExt } from "./prompt/tools"
import { createUserMessage as createUserMessageExt } from "./prompt/user-message"
import { executeCommand, CommandInput as CommandInputExt } from "./prompt/command"
import { ensureTitle as ensureTitleExt } from "./prompt/title"
import { executeSubtask as executeSubtaskExt } from "./prompt/subtask"
import { resolvePromptParts as resolvePromptPartsExt } from "./prompt/resolve-parts"
import { SessionCompactionMemory } from "./compaction-memory"
import { MemoryFacts } from "@/agent/memory-facts"
import { KnowledgeManager } from "@/agent/knowledge"
import { ResearchLedger } from "./research-ledger"
import { analyzeSessionForRecovery } from "./intelligent-recovery"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace SessionPrompt {
  const log = Log.create({ service: "session.prompt" })
  export const OUTPUT_TOKEN_MAX = Flag.NAVI_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  // State is now imported from prompt/state.ts
  export const state = promptState

  export function assertNotBusy(sessionID: string) {
    const match = state()[sessionID]
    if (match) throw new Session.BusyError(sessionID)
  }

  export const PromptInput = z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message").optional(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    agent: z.string().optional(),
    noReply: z.boolean().optional(),
    tools: z
      .record(z.string(), z.boolean())
      .optional()
      .describe(
        "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
      ),
    system: z.string().optional(),
    variant: z.string().optional(),
    parts: z.array(
      z.discriminatedUnion("type", [
        MessageV2.TextPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "TextPartInput",
          }),
        MessageV2.FilePart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "FilePartInput",
          }),
        MessageV2.AgentPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "AgentPartInput",
          }),
        MessageV2.SubtaskPart.omit({
          messageID: true,
          sessionID: true,
        })
          .partial({
            id: true,
          })
          .meta({
            ref: "SubtaskPartInput",
          }),
      ]),
    ),
  })
  export type PromptInput = z.infer<typeof PromptInput>

  export const prompt = fn(PromptInput, async (input) => {
    const session = await Session.get(input.sessionID)
    await SessionRevert.cleanup(session)

    const message = await createUserMessage(input)
    await Session.touch(input.sessionID)

    // this is backwards compatibility for allowing `tools` to be specified when
    // prompting
    const permissions: PermissionNext.Ruleset = []
    for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
      permissions.push({
        permission: tool,
        action: enabled ? "allow" : "deny",
        pattern: "*",
      })
    }
    if (permissions.length > 0) {
      session.permission = permissions
      await Session.update(session.id, (draft) => {
        draft.permission = permissions
      })
    }

    if (input.noReply === true) {
      return message
    }

    return loop(input.sessionID)
  })

  export async function resolvePromptParts(template: string): Promise<PromptInput["parts"]> {
    return resolvePromptPartsExt(template) as any
  }

  async function getResumeSummary(session: Session.Info): Promise<string | undefined> {
    if (!session.resumeFrom) return undefined

    const resumeTag = `session:${session.resumeFrom}`
    const memories = await MemoryManager.recall({
      tier: "medium",
      tags: [resumeTag],
      limit: 1,
      includeExpired: true,
    })
    const first = memories[0]
    const structured = first?.metadata?.structured
      ? SessionCompactionMemory.hasContent(first.metadata.structured)
        ? SessionCompactionMemory.render(first.metadata.structured)
        : undefined
      : undefined
    const memorySummary = structured ?? first?.content
    if (memorySummary) return memorySummary

    const messages = await Session.messages({ sessionID: session.resumeFrom })
    const summaryMessage = messages.findLast((message) => message.info.role === "assistant" && message.info.summary)
    const summaryPart = summaryMessage?.parts.find(
      (part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic,
    )
    if (summaryPart?.text) return summaryPart.text

    if (messages.length > 0) {
      const context = analyzeSessionForRecovery(messages)
      if (context.summary) {
        await MemoryManager.store(context.summary, {
          tier: "medium",
          importance: 0.7,
          tags: [resumeTag, "recovery"],
          metadata: {
            recovery: true,
            sessionID: session.resumeFrom,
            lastActivity: context.lastActivity,
          },
        })
        return context.summary
      }
    }

    return undefined
  }

  async function getProjectKnowledge(session: Session.Info): Promise<string | undefined> {
    const result = await KnowledgeManager.syncProjectKnowledge({
      projectID: session.projectID,
      worktree: Instance.worktree,
    })
    if (!result.rendered.trim()) return undefined
    return result.rendered
  }

  async function getResearchLedger(sessionID: string, agentName: string) {
    if (!["researcher", "autoresearch", "investigator", "browse"].includes(agentName)) return ""
    return await ResearchLedger.summarize(sessionID)
  }

  function start(sessionID: string) {
    const s = state()
    if (s[sessionID]) return
    const controller = new AbortController()
    s[sessionID] = {
      abort: controller,
      callbacks: [],
    }
    return controller.signal
  }

  export function cancel(sessionID: string) {
    log.info("cancel", { sessionID })
    const s = state()
    const match = s[sessionID]
    if (!match) return
    match.abort.abort()
    for (const item of match.callbacks) {
      item.reject()
    }
    delete s[sessionID]
    SessionStatus.set(sessionID, {
      type: "idle",
      permissionMode: getPermissionMode(sessionID),
      thinkingLevel: getThinkingLevel(sessionID),
      phase: "idle",
    })
    return
  }

  export const loop = fn(Identifier.schema("session"), async (sessionID) => {
    const abort = start(sessionID)
    if (!abort) {
      return new Promise<MessageV2.WithParts>((resolve, reject) => {
        const callbacks = state()[sessionID].callbacks
        callbacks.push({ resolve, reject })
      })
    }

    using _ = defer(() => cancel(sessionID))

    let step = 0
    const session = await Session.get(sessionID)
    let resumeSummary: string | undefined
    let resumeSummaryLoaded = false
    let projectKnowledgeSummary: string | undefined
    let projectKnowledgeLoaded = false
    while (true) {
      // Check budget and turns
      let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
      const totalCost = msgs.reduce(
        (acc, msg) => acc + (msg.info.role === "assistant" ? (msg.info as MessageV2.Assistant).cost : 0),
        0,
      )

      if (Flag.NAVI_MAX_BUDGET_USD && totalCost > Flag.NAVI_MAX_BUDGET_USD) {
        log.warn("budget exceeded", { sessionID, totalCost, limit: Flag.NAVI_MAX_BUDGET_USD })
        Bus.publish(Session.Event.Error, {
          sessionID,
          error: {
            name: "BudgetExceededError",
            data: { message: `Budget exceeded: $${totalCost.toFixed(4)} > $${Flag.NAVI_MAX_BUDGET_USD.toFixed(4)}` },
          },
        })
        break
      }

      if (Flag.NAVI_MAX_TURNS && step >= Flag.NAVI_MAX_TURNS) {
        log.warn("max turns exceeded", { sessionID, step, limit: Flag.NAVI_MAX_TURNS })
        Bus.publish(Session.Event.Error, {
          sessionID,
          error: {
            name: "MaxTurnsExceededError",
            data: { message: `Maximum turns exceeded: ${step} >= ${Flag.NAVI_MAX_TURNS}` },
          },
        })
        break
      }

      SessionStatus.set(sessionID, {
        type: "busy",
        permissionMode: getPermissionMode(sessionID),
        thinkingLevel: getThinkingLevel(sessionID),
        phase: "running",
        nextAction: "waiting for model response",
      })
      log.info("loop start", { step, sessionID })
      if (abort.aborted) {
        log.info("loop aborted", { sessionID })
        break
      }

      let lastUser: MessageV2.User | undefined
      let lastAssistant: MessageV2.Assistant | undefined
      let lastFinished: MessageV2.Assistant | undefined
      let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]
        if (!lastUser && msg.info.role === "user") lastUser = msg.info as MessageV2.User
        if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as MessageV2.Assistant
        if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
          lastFinished = msg.info as MessageV2.Assistant
        if (lastUser && lastFinished) break
        const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
        if (task && !lastFinished) {
          tasks.push(...task)
        }
      }

      if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
      if (
        lastAssistant?.finish &&
        !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
        lastUser.id < lastAssistant.id
      ) {
        log.info("exiting loop", { sessionID })
        break
      }

      step++
      if (step === 1)
        ensureTitle({
          session,
          modelID: lastUser.model.modelID,
          providerID: lastUser.model.providerID,
          history: msgs,
        })

      const requestedModel = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID)

      const task = tasks.pop()

      // pending subtask
      if (task?.type === "subtask") {
        const taskAgent = await Agent.get(task.agent)
        const routed = await AgentRouter.route({
          agent: taskAgent,
          requested: requestedModel,
        })
        const model = routed.model
        await executeSubtask({
          task,
          lastUser,
          sessionID,
          model,
          abort,
          session,
          messages: msgs,
        })
        continue
      }

      // pending compaction
      if (task?.type === "compaction") {
        const result = await SessionCompaction.process({
          messages: msgs,
          parentID: lastUser.id,
          abort,
          sessionID,
          auto: task.auto,
        })
        if (result === "stop") break
        continue
      }

      // context overflow, needs compaction
      if (
        lastFinished &&
        lastFinished.summary !== true &&
        (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model: requestedModel }))
      ) {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
        })
        continue
      }

      // normal processing
      const agent = await Agent.get(lastUser.agent)
      const routed = await AgentRouter.route({
        agent,
        requested: requestedModel,
      })
      const model = routed.model

      // Programmatic Agent Execution - DISABLED
      // This experimental feature was intercepting agent processing and producing
      // no visible output in the TUI. Needs proper integration before re-enabling.
      // if (agent.handleSteps) { ... }

      const policy = AgentPolicy.resolve(agent.name, agent.executionPolicy)
      const agentCost = msgs.reduce(
        (acc, msg) =>
          acc +
          (msg.info.role === "assistant" && (msg.info as MessageV2.Assistant).agent === agent.name
            ? (msg.info as MessageV2.Assistant).cost
            : 0),
        0,
      )
      if (policy.budgetUsd && agentCost > policy.budgetUsd) {
        log.warn("agent budget exceeded", { sessionID, agent: agent.name, total: agentCost, limit: policy.budgetUsd })
        Bus.publish(Session.Event.Error, {
          sessionID,
          error: {
            name: "BudgetExceededError",
            data: { message: `Agent budget exceeded: ${agent.name} $${agentCost.toFixed(4)} > $${policy.budgetUsd.toFixed(4)}` },
          },
        })
        break
      }
      const maxSteps = Math.min(agent.steps ?? Infinity, policy.maxIterations ?? Infinity)
      const isLastStep = step >= maxSteps
      msgs = insertReminders({
        messages: msgs,
        agent,
      })

      await SessionTrace.record(sessionID, {
        type: "turn.start",
        step,
        agent: agent.name,
        agentVersion: agent.version,
        promptHash: agent.prompt ? Bun.hash.xxHash32(agent.prompt).toString(16) : undefined,
        taskClass: agent.name,
        requestedModel: `${requestedModel.providerID}/${requestedModel.id}`,
        routedModel: `${model.providerID}/${model.id}`,
        reasons: routed.reasons,
        policy: {
          maxIterations: policy.maxIterations,
          maxToolCalls: policy.maxToolCalls,
          maxQuestions: policy.maxQuestions,
          maxRetries: policy.maxRetries,
          maxDelegations: policy.maxDelegations,
          budgetUsd: policy.budgetUsd,
        },
      })

      const processor = SessionProcessor.create({
        assistantMessage: (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: lastUser.id,
          role: "assistant",
          mode: agent.name,
          agent: agent.name,
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
          sessionID,
        })) as MessageV2.Assistant,
        sessionID: sessionID,
        model,
        abort,
      })

      // Check if user explicitly invoked an agent via @ in this turn
      const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
      const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

      const tools = await resolveTools({
        agent,
        session,
        model,
        tools: lastUser.tools,
        processor,
        bypassAgentCheck,
        messages: msgs,
      })

      if (step === 1) {
        SessionSummary.summarize({
          sessionID: sessionID,
          messageID: lastUser.id,
        })
      }

      const sessionMessages = [...msgs]
      // Ephemerally wrap queued user messages with a reminder to stay on track
      if (step > 1 && lastFinished) {
        for (let i = 0; i < sessionMessages.length; i++) {
          const msg = sessionMessages[i]
          if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue

          let modified = false
          for (const part of msg.parts) {
            if (part.type !== "text" || part.ignored || part.synthetic) continue
            if (!part.text.trim()) continue

            if (!modified) {
              sessionMessages[i] = clone(msg)
              modified = true
            }

            const m = sessionMessages[i] as MessageV2.WithParts
            const p = m.parts.find((p) => p.id === part.id) as MessageV2.TextPart
            if (p) {
              p.text = [
                "<system-reminder>",
                "The user sent the following message:",
                part.text,
                "",
                "Please address this message and continue with your tasks.",
                "</system-reminder>",
              ].join("\n")
            }
          }
        }
      }

      await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: sessionMessages })

      if (!resumeSummaryLoaded) {
        resumeSummary = await getResumeSummary(session)
        resumeSummaryLoaded = true
      }

      if (!projectKnowledgeLoaded) {
        projectKnowledgeSummary = await getProjectKnowledge(session)
        projectKnowledgeLoaded = true
      }

      const resumePrompt = resumeSummary ? ["## Previous Session Summary", resumeSummary, ""].join("\n") : ""

      // Recall relevant memories
      const memories = await MemoryManager.recall({
        limit: 5,
        minImportance: 0.4,
        tier: "short", // Faster, doesn't load everything from disk
      })
      const memoryPrompt =
        memories.length > 0
          ? ["## Relevant Memories", ...memories.map((m) => `- [${m.tier}] ${m.content}`), ""].join("\n")
          : ""

      const projectFacts = await MemoryFacts.recallProjectFacts(session.projectID, 6)
      const projectFactPrompt = MemoryFacts.renderProjectFacts(projectFacts)
      const projectKnowledgePrompt = projectKnowledgeSummary ? projectKnowledgeSummary : ""
      const researchLedgerPrompt = await getResearchLedger(sessionID, agent.name)

      const systemPrompts = [
        resumePrompt,
        memoryPrompt,
        projectKnowledgePrompt,
        projectFactPrompt,
        researchLedgerPrompt,
        ...(await SystemPrompt.environment()),
        ...(await SystemPrompt.specs()),
        ...(await SystemPrompt.awareness()),
        ...SystemPrompt.orchestration(agent.name),
        ...SystemPrompt.verification(agent.name),
        ...(await SystemPrompt.pinned(sessionID)),
        ...(await SystemPrompt.custom()),
      ].filter((value) => value.trim().length > 0)

      const result = await processor.process({
        user: lastUser,
        agent,
        abort,
        sessionID,
        system: systemPrompts,
        messages: iife(() => {
          const msgs = MessageV2.toModelMessage(sessionMessages)
          if (isLastStep) {
            const last = msgs[msgs.length - 1]
            if (last && last.role === "assistant") {
              if (typeof last.content === "string") {
                last.content += "\n\n" + MAX_STEPS
              } else {
                last.content.push({ type: "text", text: MAX_STEPS })
              }
            } else {
              msgs.push({
                role: "assistant" as const,
                content: MAX_STEPS,
              })
            }
          }
          return msgs
        }),
        tools,
        model,
        retries: policy.maxRetries,
        routingReasons: routed.reasons,
      })
      log.info("processor result", { sessionID, result })
      if (result === "stop") break
      if (result === "compact") {
        await SessionCompaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
        })
      }
      continue
    }
    SessionCompaction.prune({ sessionID })
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user") continue
      const queued = state()[sessionID]?.callbacks ?? []
      for (const q of queued) {
        q.resolve(item)
      }
      return item
    }
    throw new Error("Impossible")
  })

  async function lastModel(sessionID: string) {
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user" && item.info.model) return item.info.model
    }
    return Provider.defaultModel()
  }

  async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: SessionProcessor.Info
    bypassAgentCheck: boolean
    messages: MessageV2.WithParts[]
  }) {
    return resolveToolsExt(input)
  }

  async function createUserMessage(input: PromptInput) {
    return createUserMessageExt({
      ...input,
      lastModel,
    })
  }

  // insertReminders is now imported from ./prompt/reminders.ts

  export const ShellInput = z.object({
    sessionID: Identifier.schema("session"),
    agent: z.string(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    command: z.string(),
  })
  export type ShellInput = z.infer<typeof ShellInput>
  export async function shell(input: ShellInput) {
    return executeShell({
      ...input,
      lastModel,
    })
  }

  export const CommandInput = CommandInputExt
  export type CommandInput = CommandInputExt
  export async function command(input: CommandInput) {
    return executeCommand(input, {
      prompt,
      lastModel,
      resolvePromptParts,
    })
  }

  async function ensureTitle(input: {
    session: Session.Info
    history: MessageV2.WithParts[]
    providerID: string
    modelID: string
  }) {
    return ensureTitleExt(input)
  }

  async function executeSubtask(input: {
    task: MessageV2.SubtaskPart
    lastUser: MessageV2.User
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
    session: Session.Info
    messages: MessageV2.WithParts[]
  }) {
    return executeSubtaskExt(input)
  }
}
