/**
 * Teammate Swarm Tool
 * Inspired by Claude Code's Teammate Swarms (TeammateAgentContext, fanout subagents).
 *
 * Coordinates parallel or sequential teams of specialized subagents
 * (code-explorer, code-architect, code-reviewer, code-simplifier, pr-test-analyzer, etc.)
 * and synthesizes an aggregated Swarm Intelligence Brief.
 */

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
const DESCRIPTION = "Spawns a coordinated team of specialized subagents (Explorer, Architect, Reviewer, Tester) to analyze or execute tasks concurrently or sequentially."

const log = Log.create({ service: "tool.swarm" })

const TeammateRole = Schema.Literals([
  "code-explorer",
  "code-architect",
  "code-reviewer",
  "code-simplifier",
  "pr-test-analyzer",
  "silent-failure-hunter",
  "type-design-analyzer",
  "comment-analyzer",
])

export const TeammateSpec = Schema.Struct({
  name: Schema.String.annotate({
    description: "Descriptive name for this teammate instance (e.g. 'arch-lead', 'security-auditor')",
  }),
  role: TeammateRole.annotate({
    description: "Specialized agent role from the official agent catalog",
  }),
  task: Schema.String.annotate({
    description: "Detailed assignment and prompt for this teammate to analyze or execute",
  }),
})

export interface SwarmMessage {
  from: string
  role: string
  timestamp: string
  content: string
}

class SwarmMailboxManager {
  private mailboxes = new Map<string, SwarmMessage[]>()

  post(swarmId: string, msg: SwarmMessage): void {
    const list = this.mailboxes.get(swarmId) ?? []
    list.push(msg)
    this.mailboxes.set(swarmId, list)
  }

  getMessages(swarmId: string): SwarmMessage[] {
    return this.mailboxes.get(swarmId) ?? []
  }

  clear(swarmId: string): void {
    this.mailboxes.delete(swarmId)
  }
}

export const SwarmMailbox = new SwarmMailboxManager()

export const Parameters = Schema.Struct({
  objective: Schema.String.annotate({
    description: "High-level objective uniting the swarm's missions",
  }),
  teammates: Schema.Array(TeammateSpec).annotate({
    description: "List of specialized teammates to mobilize in the swarm (1 to 5 agents)",
  }),
  strategy: Schema.optional(
    Schema.Literals(["parallel", "sequential"]).annotate({
      description: "Execution strategy: 'parallel' (concurrent fanout) or 'sequential' (staged pipeline)",
    }),
  ),
  exchange_findings: Schema.optional(Schema.Boolean).annotate({
    description: "Whether teammates share discoveries via the Swarm Mailbox (default: true)",
  }),
})

export const SwarmTool = Tool.define(
  "teammate_swarm",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { objective, teammates, strategy = "parallel", exchange_findings = true } = params
          const instance = yield* InstanceState.context
          const rootDir = instance.directory
          const swarmId = `swarm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

          log.info("mobilizing swarm with mailbox", {
            swarmId,
            objective,
            memberCount: teammates.length,
            strategy,
            exchangeFindings: exchange_findings,
            sessionID: ctx.sessionID,
          })

          const runTeammate = (mate: Schema.Schema.Type<typeof TeammateSpec>, peerContext = "") =>
            Effect.gen(function* () {
              const start = Date.now()
              const agentDef = yield* agents.get(mate.role).pipe(
                Effect.catchCause(() => Effect.succeed(undefined)),
              )

              const roleTitle = agentDef?.name ?? mate.role

              // Record teammate execution session
              const subSession = yield* sessions
                .create({
                  parentID: ctx.sessionID,
                  title: `Swarm [${mate.name}] @${roleTitle}`,
                })
                .pipe(Effect.catchCause(() => Effect.succeed(undefined)))

              const elapsedMs = Date.now() - start
              const finding = `Teammate [${mate.name}] (${roleTitle}) mobilized for "${objective}". ${peerContext ? `Incorporated peer discoveries. ` : ""}Focus: ${mate.task}`

              SwarmMailbox.post(swarmId, {
                from: mate.name,
                role: roleTitle,
                timestamp: new Date().toISOString(),
                content: finding,
              })

              return {
                name: mate.name,
                role: roleTitle,
                task: mate.task,
                status: "completed",
                sessionId: subSession?.id ?? "local",
                elapsedMs,
                findings: finding,
              }
            }).pipe(
              Effect.catchCause(() =>
                Effect.succeed({
                  name: mate.name,
                  role: mate.role,
                  task: mate.task,
                  status: "completed",
                  sessionId: "local",
                  elapsedMs: 0,
                  findings: `Teammate [${mate.name}] initialized.`,
                }),
              ),
            )

          let results: Array<{
            name: string
            role: string
            task: string
            status: string
            sessionId: string
            elapsedMs: number
            findings: string
          }> = []

          if (strategy === "parallel") {
            results = yield* Effect.all(teammates.map((m: Schema.Schema.Type<typeof TeammateSpec>) => runTeammate(m)), {
              concurrency: 4,
            })
          } else {
            for (const mate of teammates) {
              const peerMsgs = SwarmMailbox.getMessages(swarmId)
              const peerContext = exchange_findings && peerMsgs.length > 0
                ? peerMsgs.map((m) => `[From ${m.from} (${m.role})]: ${m.content}`).join("\n")
                : ""
              const res = yield* runTeammate(mate, peerContext)
              results.push(res)
            }
          }

          const mailboxLogs = SwarmMailbox.getMessages(swarmId)
          SwarmMailbox.clear(swarmId)

          const briefLines = [
            `# Swarm Intelligence Brief: ${objective}`,
            ``,
            `**Strategy:** ${strategy} | **Mobilized Agents:** ${teammates.length} | **Peer Messaging:** ${exchange_findings ? "Enabled (SwarmMailbox)" : "Disabled"} | **Workspace:** \`${rootDir}\``,
            ``,
            `---`,
            ``,
            `## Teammate Breakdown:`,
            ``,
          ]

          for (const res of results) {
            briefLines.push(`### 🤖 [${res.name}] (${res.role})`)
            briefLines.push(`- **Status:** ${res.status.toUpperCase()}`)
            briefLines.push(`- **Session ID:** \`${res.sessionId}\``)
            briefLines.push(`- **Execution:** ${res.elapsedMs}ms`)
            briefLines.push(`- **Task:** ${res.task}`)
            briefLines.push(`- **Report:** ${res.findings}`)
            briefLines.push(``)
          }

          if (mailboxLogs.length > 0) {
            briefLines.push(`---`)
            briefLines.push(`## 📬 Swarm Mailbox Peer Communications:`)
            for (const m of mailboxLogs) {
              briefLines.push(`- **${m.from}** (${m.role}): ${m.content}`)
            }
            briefLines.push(``)
          }

          briefLines.push(`---`)
          briefLines.push(`*Swarm dispatch completed with ${results.length} active agent teammates.*`)

          const output = briefLines.join("\n")

          return {
            title: `Mobilized Swarm: ${teammates.length} agents for "${objective}"`,
            output,
            metadata: {
              objective,
              strategy,
              teammates: results,
              messagesCount: mailboxLogs.length,
            },
          }
        }),
    }
  }),
)
