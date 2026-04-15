/**
 * Team Manager — In-memory agent team registry.
 *
 * Teams are groups of agents that can collaborate on tasks.
 * The master agent creates a team, assigns members, and sends messages to them.
 */

import { Log } from "../util/log"
import { SharedMemory } from "../agent/memory"

const log = Log.create({ service: "team-manager" })

export type TeamMember = {
  agentType: string
  sessionID?: string
  role?: string
}

export type Team = {
  id: string
  name: string
  description: string
  members: TeamMember[]
  createdAt: string
  createdBy: string
  messages: TeamMessage[]
}

export type TeamMessage = {
  id: string
  from: string
  to: string | "broadcast"
  content: string
  timestamp: string
  read: boolean
}

const TEAM_NAMESPACE = "teams"

export namespace TeamManager {
  function teamKey(id: string) {
    return `team:${id}`
  }

  /**
   * Create a new team.
   */
  export async function create(params: {
    name: string
    description: string
    members: TeamMember[]
    createdBy: string
  }): Promise<Team> {
    const id = `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const team: Team = {
      id,
      name: params.name,
      description: params.description,
      members: params.members,
      createdAt: new Date().toISOString(),
      createdBy: params.createdBy,
      messages: [],
    }
    await SharedMemory.set(teamKey(id), team, TEAM_NAMESPACE)
    log.info("team created", { id, name: params.name, members: params.members.length })
    return team
  }

  /**
   * Get a team by ID.
   */
  export async function get(id: string): Promise<Team | undefined> {
    return SharedMemory.get(teamKey(id), TEAM_NAMESPACE) as Promise<Team | undefined>
  }

  /**
   * Delete a team.
   */
  export async function destroy(id: string): Promise<void> {
    const team = await get(id)
    if (!team) throw new Error(`Team not found: ${id}`)
    // Note: SharedMemory.delete would need to be implemented; for now mark as destroyed
    await SharedMemory.set(teamKey(id), null, TEAM_NAMESPACE)
    log.info("team deleted", { id })
  }

  /**
   * List all teams.
   */
  export async function list(): Promise<Team[]> {
    const keys = await SharedMemory.list(TEAM_NAMESPACE)
    const teams: Team[] = []
    for (const key of keys) {
      const team = await SharedMemory.get(key, TEAM_NAMESPACE) as Team | null
      if (team) teams.push(team)
    }
    return teams
  }

  /**
   * Send a message to a team member or broadcast to all.
   */
  export async function sendMessage(params: {
    teamId: string
    from: string
    to: string | "broadcast"
    content: string
  }): Promise<TeamMessage> {
    const team = await get(params.teamId)
    if (!team) throw new Error(`Team not found: ${params.teamId}`)

    const message: TeamMessage = {
      id: `msg-${Date.now()}`,
      from: params.from,
      to: params.to,
      content: params.content,
      timestamp: new Date().toISOString(),
      read: false,
    }

    team.messages.push(message)
    await SharedMemory.set(teamKey(params.teamId), team, TEAM_NAMESPACE)
    log.info("message sent", { teamId: params.teamId, from: params.from, to: params.to })
    return message
  }

  /**
   * Read messages for a team member.
   */
  export async function readMessages(teamId: string, memberId: string): Promise<TeamMessage[]> {
    const team = await get(teamId)
    if (!team) throw new Error(`Team not found: ${teamId}`)

    const messages = team.messages.filter(
      (m) => !m.read && (m.to === memberId || m.to === "broadcast") && m.from !== memberId,
    )

    // Mark as read
    for (const msg of messages) {
      msg.read = true
    }
    await SharedMemory.set(teamKey(teamId), team, TEAM_NAMESPACE)
    return messages
  }

  /**
   * Format team for display.
   */
  export function format(team: Team): string {
    return [
      `## Team: ${team.name} (${team.id})`,
      team.description,
      ``,
      `**Members** (${team.members.length}):`,
      ...team.members.map((m) => `- ${m.role ?? m.agentType}: ${m.agentType}${m.sessionID ? ` (${m.sessionID})` : ""}`),
      ``,
      `**Messages**: ${team.messages.length}`,
      `Created: ${new Date(team.createdAt).toLocaleString()}`,
    ].join("\n")
  }
}
