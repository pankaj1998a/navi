import z from "zod"
import type { MessageV2 } from "@/session/message-v2"

export namespace AgentPolicy {
  export const Info = z
    .object({
      maxIterations: z.number().int().positive().optional(),
      maxToolCalls: z.number().int().positive().optional(),
      maxQuestions: z.number().int().positive().optional(),
      maxRetries: z.number().int().nonnegative().optional(),
      maxDelegations: z.number().int().positive().optional(),
      budgetUsd: z.number().positive().optional(),
    })
    .meta({
      ref: "AgentExecutionPolicy",
    })
  export type Info = z.infer<typeof Info>

  const DEFAULTS: Record<string, Info> = {
    build: { maxIterations: 12, maxToolCalls: 18, maxRetries: 2, maxDelegations: 6, budgetUsd: 10 },
    vibemode: { maxIterations: 10, maxToolCalls: 16, maxRetries: 1, maxDelegations: 10, maxQuestions: 3, budgetUsd: 12 },
    ask: { maxIterations: 6, maxToolCalls: 8, maxRetries: 1, maxQuestions: 2 },
    general: { maxIterations: 8, maxToolCalls: 10, maxRetries: 1, maxDelegations: 4 },
    researcher: { maxIterations: 8, maxToolCalls: 12, maxRetries: 1, maxDelegations: 5, maxQuestions: 2 },
    autoresearch: { maxIterations: 8, maxToolCalls: 12, maxRetries: 1, maxDelegations: 5, maxQuestions: 2 },
    explore: { maxIterations: 5, maxToolCalls: 8, maxRetries: 0 },
    investigator: { maxIterations: 6, maxToolCalls: 10, maxRetries: 0, maxDelegations: 2, maxQuestions: 1, budgetUsd: 3 },
    review: { maxIterations: 5, maxToolCalls: 6, maxRetries: 1 },
    qa: { maxIterations: 6, maxToolCalls: 8, maxRetries: 1 },
    "qa-only": { maxIterations: 5, maxToolCalls: 6, maxRetries: 0 },
    browse: { maxIterations: 5, maxToolCalls: 8, maxRetries: 0 },
    ship: { maxIterations: 8, maxToolCalls: 10, maxRetries: 1, maxDelegations: 4 },
  }

  const FALLBACK: Info = {
    maxIterations: 6,
    maxToolCalls: 8,
    maxRetries: 1,
    maxDelegations: 3,
    maxQuestions: 2,
  }

  const DELEGATION_TOOLS = new Set(["task", "agent", "subagent", "swarm", "parallel", "consensus"])

  export function defaultsForAgent(agentName: string): Info {
    return {
      ...FALLBACK,
      ...(DEFAULTS[agentName] ?? {}),
    }
  }

  export function resolve(agentName: string, policy?: Partial<Info>): Info {
    return {
      ...defaultsForAgent(agentName),
      ...(policy ?? {}),
    }
  }

  export function isDelegationTool(toolName: string) {
    return DELEGATION_TOOLS.has(toolName)
  }

  export function countToolCalls(parts: MessageV2.Part[]) {
    return parts.filter((part) => part.type === "tool").length
  }

  export function countDelegations(parts: MessageV2.Part[]) {
    return parts.filter((part) => part.type === "tool" && isDelegationTool(part.tool)).length
  }

  export function countQuestionTools(parts: MessageV2.Part[]) {
    return parts.filter((part) => part.type === "tool" && part.tool === "question").length
  }
}


