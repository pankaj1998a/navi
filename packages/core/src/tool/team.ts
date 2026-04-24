import z from "zod"
import { Tool } from "./tool"
import { TeamManager } from "../agent/team-manager"

/**
 * TeamCreateTool — Create a named team of collaborating agents.
 */
export const TeamCreateTool = Tool.define("team_create", {
  description: `Create a named team of collaborating agents for complex multi-agent workflows.

Teams allow you to:
- Organize agents by role and responsibility  
- Send targeted messages between agents
- Broadcast updates to all team members
- Track team state and progress

After creating a team, use team_send_message to coordinate agents.`,

  parameters: z.object({
    name: z.string().describe("Team name (e.g. 'frontend-squad')"),
    description: z.string().describe("What this team is working on"),
    members: z.array(
      z.object({
        agentType: z.string().describe("Agent type (e.g. 'frontend', 'backend', 'qa')"),
        role: z.string().optional().describe("Role in team (e.g. 'lead', 'reviewer')"),
      }),
    ).describe("Initial team members"),
  }),

  async execute(params, ctx) {
    const team = await TeamManager.create({
      name: params.name,
      description: params.description,
      members: params.members,
      createdBy: ctx.agent,
    })

    return {
      title: `Team: ${params.name}`,
      metadata: {},
      output: [
        `✅ Team created successfully.`,
        ``,
        TeamManager.format(team),
        ``,
        `Use \`team_send_message\` with teamId="${team.id}" to coordinate agents.`,
      ].join("\n"),
    }
  },
})

/**
 * TeamDeleteTool — Disband a team.
 */
export const TeamDeleteTool = Tool.define("team_delete", {
  description: "Disband an agent team and clean up its resources.",

  parameters: z.object({
    teamId: z.string().describe("ID of the team to delete"),
  }),

  async execute(params, _ctx) {
    await TeamManager.destroy(params.teamId)
    return {
      title: `Team ${params.teamId} disbanded`,
      metadata: {},
      output: `✅ Team ${params.teamId} has been disbanded.`,
    }
  },
})

/**
 * SendMessageTool — Send a message to a team member or broadcast to all.
 */
export const SendMessageTool = Tool.define("team_send_message", {
  description: `Send a message to an agent team member or broadcast to all members.

Use this to:
- Delegate subtasks to specific agents
- Share findings with the whole team
- Request status updates from agents
- Coordinate parallel work`,

  parameters: z.object({
    teamId: z.string().describe("Team ID to send message to"),
    to: z.string().describe("Agent type to send to, or 'broadcast' to send to all members"),
    content: z.string().describe("Message content — task instructions, findings, or coordination"),
  }),

  async execute(params, ctx) {
    const message = await TeamManager.sendMessage({
      teamId: params.teamId,
      from: ctx.agent,
      to: params.to,
      content: params.content,
    })

    const recipient = params.to === "broadcast" ? "all team members" : params.to
    return {
      title: `Message → ${recipient}`,
      metadata: {},
      output: [
        `✅ Message sent to ${recipient}.`,
        ``,
        `**Message ID**: ${message.id}`,
        `**To**: ${params.to}`,
        `**Content**: ${params.content.slice(0, 200)}${params.content.length > 200 ? "…" : ""}`,
      ].join("\n"),
    }
  },
})
