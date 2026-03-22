import { PermissionNext } from "@/permission/next"
import type { Agent } from "./agent"

export type SpawnCaller = Pick<Agent.Info, "permission" | "spawnableAgents">

export function canSpawnAgent(caller: SpawnCaller | undefined, agentName: string) {
  if (!caller) return true
  if (caller.spawnableAgents?.length && !caller.spawnableAgents.includes(agentName)) return false
  return PermissionNext.evaluate("task", agentName, caller.permission).action !== "deny"
}

export function filterSpawnableAgents<T extends { name: string }>(caller: SpawnCaller | undefined, agents: T[]) {
  return agents.filter((agent) => canSpawnAgent(caller, agent.name))
}
