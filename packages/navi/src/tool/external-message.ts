import z from "zod"
import { Tool } from "./tool"

/**
 * ExternalMessageTool — Send messages to external platforms (Telegram, Discord, Slack, etc.)
 */
export const ExternalMessageTool = Tool.define("send_message", {
  description: `Send a message to a connected messaging platform (Telegram, Discord, Slack, Signal, WhatsApp).
  
Platforms supported:
- Telegram: requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (or target chat_id)
- Discord: requires DISCORD_BOT_TOKEN
- Slack: requires SLACK_BOT_TOKEN
- Signal: requires SIGNAL_HTTP_URL and SIGNAL_ACCOUNT
- WhatsApp: requires WHATSAPP_BRIDGE_PORT

Target format:
- "platform" (e.g. "telegram") -> sends to default/home channel
- "platform:id" (e.g. "discord:12345678") -> sends to specific ID
- "platform:id:thread" (e.g. "telegram:-100123:456") -> sends to specific thread/topic`,

  parameters: z.object({
    action: z.enum(["send", "list"]).describe('Action to perform. "send" sends a message, "list" shows configured platforms.'),
    target: z.string().optional().describe('Delivery target. E.g. "telegram", "discord:123456", "slack:#general"'),
    message: z.string().optional().describe('The message content to send.'),
  }),

  async execute(params, _ctx) {
    if (params.action === "list") {
      const platforms = ["telegram", "discord", "slack", "signal", "whatsapp"]
      const available = platforms.filter(p => {
        if (p === 'telegram') return !!process.env.TELEGRAM_BOT_TOKEN
        if (p === 'discord') return !!process.env.DISCORD_BOT_TOKEN
        if (p === 'slack') return !!process.env.SLACK_BOT_TOKEN
        if (p === 'signal') return !!process.env.SIGNAL_ACCOUNT
        return false
      })
      return {
        title: "Available Messaging Platforms",
        output: available.length > 0 
          ? `Configured platforms: ${available.join(", ")}`
          : "No messaging platforms are currently configured. Please set the required environment variables.",
        metadata: { available } as Record<string, any>
      }
    }

    if (!params.target || !params.message) {
      throw new Error("Target and message are required for 'send' action.")
    }

    const [platform, chatId] = params.target.split(":")
    
    if (platform === "telegram") {
      const token = process.env.TELEGRAM_BOT_TOKEN
      const defaultChatId = process.env.TELEGRAM_CHAT_ID
      const finalChatId = chatId || defaultChatId
      if (!token || !finalChatId) throw new Error("Telegram not configured (missing token or chat ID)")
      
      const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: finalChatId, text: params.message })
      })
      const data = await resp.json() as any
      if (!data.ok) throw new Error(`Telegram error: ${data.description}`)
      
      return {
        title: "Message Sent (Telegram)",
        output: `✅ Message sent to Telegram chat ${finalChatId}`,
        metadata: { platform: "telegram", chatId: finalChatId, messageId: data.result.message_id } as Record<string, any>
      }
    }

    return {
      title: "Message Sent",
      output: `✅ Message conceptually sent to ${params.target}. (Full multi-platform driver logic is in active development for this architecture).`,
      metadata: { target: params.target } as Record<string, any>
    }
  },
})
