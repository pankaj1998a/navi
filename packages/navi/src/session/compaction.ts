import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { SessionPrompt } from "./prompt"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { MemoryManager } from "@/agent/memory-manager"
import { MemoryFacts } from "@/agent/memory-facts"
import { SessionCompactionMemory } from "./compaction-memory"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    const context = input.model.limit.context
    if (context === 0) return false
    const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
    const output = Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) || SessionPrompt.OUTPUT_TOKEN_MAX
    const usable = context - output
    return count > usable
  }

  // Legacy constants (used as fallback when model is not available)
  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  /**
   * Dynamic pruning thresholds based on the model's context window.
   * Scales protection and minimum thresholds relative to available context.
   */
  export function getPruneThresholds(contextWindow?: number) {
    if (!contextWindow || contextWindow === 0) {
      return { minimum: PRUNE_MINIMUM, protect: PRUNE_PROTECT }
    }
    return {
      minimum: Math.max(10_000, Math.floor(contextWindow * 0.05)), // 5% of context
      protect: Math.max(20_000, Math.floor(contextWindow * 0.1)), // 10% of context
    }
  }

  // Tool importance weights for pruning decisions
  // Higher weight = more likely to be kept
  const TOOL_IMPORTANCE: Record<string, number> = {
    skill: 1.0, // always protected
    read: 0.3, // file reads are low value after initial context
    write: 0.8, // writes are important context
    edit: 0.8, // edits are important context
    bash: 0.5, // command output varies in importance
    ls: 0.2, // directory listings are very transient
    search: 0.4, // search results are medium value
    task: 0.9, // task results are high value
  }

  function getToolImportance(toolName: string): number {
    return TOOL_IMPORTANCE[toolName] ?? 0.5
  }

  const PRUNE_PROTECTED_TOOLS = ["skill"]

  // goes backwards through parts, dynamically adjusting thresholds based on model context.
  // uses importance weighting to preferentially prune low-value tool outputs first.
  export async function prune(input: { sessionID: string; contextWindow?: number }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return
    log.info("pruning")

    const thresholds = getPruneThresholds(input.contextWindow)
    const msgs = await Session.messages({ sessionID: input.sessionID })
    let total = 0
    let pruned = 0
    const toPrune: Array<{ part: MessageV2.ToolPart; importance: number; estimate: number }> = []
    let turns = 0

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break loop
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "tool")
          if (part.state.status === "completed") {
            if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue

            if (part.state.time.compacted) break loop
            const estimate = Token.estimate(part.state.output)
            total += estimate
            if (total > thresholds.protect) {
              const importance = getToolImportance(part.tool)
              pruned += estimate
              toPrune.push({ part, importance, estimate })
            }
          }
      }
    }

    // Sort by importance (ascending) — prune least important first
    toPrune.sort((a, b) => a.importance - b.importance)

    log.info("found", { pruned, total, thresholds })
    if (pruned > thresholds.minimum) {
      let prunedSoFar = 0
      for (const { part, estimate } of toPrune) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          await Session.updatePart(part)
          prunedSoFar += estimate
        }
        // Stop pruning once we've freed enough tokens
        if (prunedSoFar >= thresholds.minimum) break
      }
      log.info("pruned", { count: toPrune.length, prunedTokens: prunedSoFar })
    }
  }

  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }) {
    const session = await Session.get(input.sessionID)
    const userMessage = input.messages.findLast((m) => m.info.id === input.parentID)!.info as MessageV2.User
    const agent = await Agent.get("compaction")
    const model = agent.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: "compaction",
      agent: "compaction",
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant
    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })
    // Allow plugins to inject context or replace compaction prompt
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [], prompt: undefined },
    )
    const defaultPrompt = [
      "Create a continuation brief for the next model turn.",
      "Use markdown with these exact headings when information exists:",
      "## Objective",
      "## Completed",
      "## In Progress",
      "## Files",
      "## Constraints",
      "## Decisions",
      "## Next Steps",
      "Keep each bullet short and concrete. Prefer current work, active files, user constraints, and the next best action.",
    ].join("\n")
    const promptText = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")
    const result = await processor.process({
      user: userMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: [],
      messages: [
        ...MessageV2.toModelMessage(input.messages),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
          ],
        },
      ],
      model,
    })

    // Store the summary in medium-tier memory
    const parts = await MessageV2.parts(msg.id)
    const textPart = parts.find((p): p is MessageV2.TextPart => p.type === "text")
    if (textPart) {
      const staleSummaries = await MemoryManager.recall({
        tier: "medium",
        tags: ["compaction-summary", `session:${input.sessionID}`],
        includeExpired: true,
        limit: 50,
      })
      for (const stale of staleSummaries) {
        await MemoryManager.remove(stale.id)
      }

      const structured = SessionCompactionMemory.parse(textPart.text)
      await MemoryManager.store(textPart.text, {
        tier: "medium",
        importance: 0.8,
        tags: ["compaction-summary", `session:${input.sessionID}`],
        metadata: {
          sessionID: input.sessionID,
          kind: "compaction-summary",
          confidence: 0.9,
          source: {
            type: "session-compaction",
            sessionID: input.sessionID,
            messageID: msg.id,
          },
          structured,
        },
      })

      await MemoryFacts.storeCompactionFacts({
        summary: structured,
        projectID: session.projectID,
        source: {
          type: "session-compaction",
          sessionID: input.sessionID,
          messageID: msg.id,
          projectID: session.projectID,
        },
      })
      await MemoryFacts.cleanupProjectFacts(session.projectID)
    }

    if (result === "continue" && input.auto) {
      const continueMsg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: input.sessionID,
        time: {
          created: Date.now(),
        },
        agent: userMessage.agent,
        model: userMessage.model,
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: continueMsg.id,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,
        text: "Continue if you have next steps",
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      })
    }
    if (processor.message.error) return "stop"
    Bus.publish(Event.Compacted, { sessionID: input.sessionID })
    return "continue"
  }

  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      agent: z.string(),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      auto: z.boolean(),
    }),
    async (input) => {
      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
      })
    },
  )
}
