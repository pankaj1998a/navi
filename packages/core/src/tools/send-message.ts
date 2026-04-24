/**
 * SendMessageTool — Phase 3: Messaging & Notifications
 *
 * Ported from hermes-agent/tools/send_message_tool.py
 * Supports: Telegram, Discord, Slack, Signal, WhatsApp, Email, SMS (Twilio)
 *
 * Environment Variables Required per Platform:
 *   Telegram:  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *   Discord:   DISCORD_BOT_TOKEN
 *   Slack:     SLACK_BOT_TOKEN
 *   Signal:    SIGNAL_HTTP_URL, SIGNAL_ACCOUNT
 *   WhatsApp:  WHATSAPP_BRIDGE_PORT (default: 3000)
 *   Email:     EMAIL_ADDRESS, EMAIL_PASSWORD, EMAIL_SMTP_HOST, EMAIL_SMTP_PORT
 *   SMS:       TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 */

import { BaseDeclarativeTool, BaseToolInvocation, Kind, type ToolInvocation, type ToolResult } from './tools.ts';
import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import { ToolErrorType } from './tool-error.ts';
import { debugLogger } from '../util/debugLogger.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendMessageToolParams {
  action: 'send' | 'list';
  target?: string;   // e.g. "telegram", "discord:123456789", "slack:#general"
  message?: string;
}

export interface SendMessageToolResult extends ToolResult {}

type Platform = 'telegram' | 'discord' | 'slack' | 'signal' | 'whatsapp' | 'email' | 'sms';

interface PlatformConfig {
  token?: string;
  chatId?: string;
  extra?: Record<string, string>;
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

function getPlatformConfig(platform: Platform): PlatformConfig | null {
  switch (platform) {
    case 'telegram': {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (!token) return null;
      return { token, chatId };
    }
    case 'discord': {
      const token = process.env.DISCORD_BOT_TOKEN;
      if (!token) return null;
      return { token };
    }
    case 'slack': {
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) return null;
      return { token };
    }
    case 'signal': {
      const httpUrl = process.env.SIGNAL_HTTP_URL || 'http://127.0.0.1:8080';
      const account = process.env.SIGNAL_ACCOUNT;
      if (!account) return null;
      return { extra: { httpUrl, account } };
    }
    case 'whatsapp': {
      const bridgePort = process.env.WHATSAPP_BRIDGE_PORT || '3000';
      return { extra: { bridgePort } };
    }
    case 'email': {
      const address = process.env.EMAIL_ADDRESS;
      const password = process.env.EMAIL_PASSWORD;
      const smtpHost = process.env.EMAIL_SMTP_HOST;
      const smtpPort = process.env.EMAIL_SMTP_PORT || '587';
      if (!address || !password || !smtpHost) return null;
      return { extra: { address, password, smtpHost, smtpPort } };
    }
    case 'sms': {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_PHONE_NUMBER;
      if (!accountSid || !authToken || !fromNumber) return null;
      return { token: authToken, extra: { accountSid, fromNumber } };
    }
    default:
      return null;
  }
}

function listAvailableTargets(): string {
  const platforms: Platform[] = ['telegram', 'discord', 'slack', 'signal', 'whatsapp', 'email', 'sms'];
  const available: string[] = [];
  const missing: string[] = [];

  for (const p of platforms) {
    if (getPlatformConfig(p)) {
      available.push(`✅ ${p}`);
    } else {
      missing.push(`❌ ${p} (credentials not set)`);
    }
  }

  return [
    '## Configured Messaging Platforms\n',
    ...available,
    '',
    '## Not Configured\n',
    ...missing,
    '',
    '### Usage examples',
    '- `target: "telegram"` — sends to home channel (TELEGRAM_CHAT_ID)',
    '- `target: "discord:123456789"` — sends to Discord channel by ID',
    '- `target: "slack:#general"` — sends to Slack channel by name',
  ].join('\n');
}

function parseTarget(target: string): { platform: Platform; chatId: string | null; threadId: string | null } {
  const parts = target.split(':');
  const platform = parts[0].trim().toLowerCase() as Platform;
  let chatId: string | null = null;
  let threadId: string | null = null;

  if (parts.length === 2) {
    chatId = parts[1].trim();
  } else if (parts.length === 3) {
    chatId = parts[1].trim();
    threadId = parts[2].trim();
  }

  return { platform, chatId, threadId };
}

async function sendTelegram(token: string, chatId: string, message: string, threadId?: string | null): Promise<Record<string, unknown>> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
  };
  if (threadId) body.message_thread_id = parseInt(threadId);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.tson() as any;
    if (!data.ok) {
      // Fallback: retry without parse_mode
      const fallbackBody = { ...body, parse_mode: undefined };
      const fallback = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fallbackBody),
      });
      const fallbackData = await fallback.tson() as any;
      if (!fallbackData.ok) {
        return { error: `Telegram API error: ${fallbackData.description}` };
      }
      return { success: true, platform: 'telegram', chat_id: chatId, message_id: String(fallbackData.result.message_id) };
    }
    return { success: true, platform: 'telegram', chat_id: chatId, message_id: String(data.result.message_id) };
  } catch (e: any) {
    return { error: `Telegram send failed: ${e.message}` };
  }
}

async function sendDiscord(token: string, chatId: string, message: string, threadId?: string | null): Promise<Record<string, unknown>> {
  const channelId = threadId || chatId;
  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { error: `Discord API error (${resp.status}): ${body}` };
    }
    const data = await resp.tson() as any;
    return { success: true, platform: 'discord', chat_id: chatId, message_id: data.id };
  } catch (e: any) {
    return { error: `Discord send failed: ${e.message}` };
  }
}

async function sendSlack(token: string, channelId: string, message: string): Promise<Record<string, unknown>> {
  try {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId, text: message, mrkdwn: true }),
    });
    const data = await resp.tson() as any;
    if (!data.ok) return { error: `Slack API error: ${data.error}` };
    return { success: true, platform: 'slack', chat_id: channelId, message_id: data.ts };
  } catch (e: any) {
    return { error: `Slack send failed: ${e.message}` };
  }
}

async function sendSignal(httpUrl: string, account: string, recipient: string, message: string): Promise<Record<string, unknown>> {
  try {
    const payload = {
      jsonrpc: '2.0',
      method: 'send',
      params: { account, recipient: [recipient], message },
      id: `send_${Date.now()}`,
    };
    const resp = await fetch(`${httpUrl}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.tson() as any;
    if (data.error) return { error: `Signal RPC error: ${JSON.stringify(data.error)}` };
    return { success: true, platform: 'signal', chat_id: recipient };
  } catch (e: any) {
    return { error: `Signal send failed: ${e.message}` };
  }
}

async function sendWhatsApp(bridgePort: string, chatId: string, message: string): Promise<Record<string, unknown>> {
  try {
    const resp = await fetch(`http://localhost:${bridgePort}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { error: `WhatsApp bridge error (${resp.status}): ${body}` };
    }
    const data = await resp.tson() as any;
    return { success: true, platform: 'whatsapp', chat_id: chatId, message_id: data.messageId };
  } catch (e: any) {
    return { error: `WhatsApp send failed: ${e.message}` };
  }
}

// ─── Tool Invocation ──────────────────────────────────────────────────────────

class SendMessageToolInvocation extends BaseToolInvocation<SendMessageToolParams, SendMessageToolResult> {
  constructor(
    params: SendMessageToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
    _workspaceRoots?: readonly string[],
  ) {
    super(params, messageBus, _toolName, _toolDisplayName, undefined, _kind, _workspaceRoots);
  }

  async execute(_signal: AbortSignal): Promise<SendMessageToolResult> {
    try {
      if (this.params.action === 'list') {
        return {
          llmContent: listAvailableTargets(),
          returnDisplay: 'Listed available messaging targets.',
        };
      }

      // action === 'send'
      const { target, message } = this.params;
      if (!target || !message) {
        return {
          llmContent: 'Error: Both `target` and `message` are required when action="send".',
          returnDisplay: 'Missing parameters.',
          error: { message: 'Missing target or message', type: ToolErrorType.UNKNOWN },
        };
      }

      const { platform, chatId, threadId } = parseTarget(target);
      const cfg = getPlatformConfig(platform);

      if (!cfg) {
        return {
          llmContent: `Error: Platform "${platform}" is not configured. Set the required environment variables and try again.\nRun action="list" to see configured platforms.`,
          returnDisplay: `Platform ${platform} not configured.`,
          error: { message: `Platform ${platform} not configured`, type: ToolErrorType.UNKNOWN },
        };
      }

      let result: Record<string, unknown>;

      switch (platform) {
        case 'telegram': {
          const resolvedChatId = chatId || cfg.chatId || '';
          if (!resolvedChatId) return this.missingEnv('TELEGRAM_CHAT_ID');
          result = await sendTelegram(cfg.token!, resolvedChatId, message, threadId);
          break;
        }
        case 'discord': {
          if (!chatId) return this.missingParam('Discord channel ID (e.g. target: "discord:123456789")');
          result = await sendDiscord(cfg.token!, chatId, message, threadId);
          break;
        }
        case 'slack': {
          if (!chatId) return this.missingParam('Slack channel (e.g. target: "slack:#general" or "slack:C1234567890")');
          result = await sendSlack(cfg.token!, chatId, message);
          break;
        }
        case 'signal': {
          if (!chatId) return this.missingParam('Signal recipient number (e.g. target: "signal:+15551234567")');
          result = await sendSignal(cfg.extra!.httpUrl, cfg.extra!.account, chatId, message);
          break;
        }
        case 'whatsapp': {
          if (!chatId) return this.missingParam('WhatsApp chatId');
          result = await sendWhatsApp(cfg.extra!.bridgePort, chatId, message);
          break;
        }
        default:
          result = { error: `Platform "${platform}" send not yet implemented in this port. PR welcome!` };
      }

      if (result.error) {
        return {
          llmContent: `Messaging Error: ${result.error}`,
          returnDisplay: `Failed to send to ${platform}.`,
          error: { message: String(result.error), type: ToolErrorType.UNKNOWN },
        };
      }

      return {
        llmContent: `✅ Message sent successfully!\nPlatform: ${platform}\nChat ID: ${result.chat_id}\nMessage ID: ${result.message_id ?? 'N/A'}`,
        returnDisplay: `Message sent to ${platform}.`,
      };
    } catch (e: any) {
      debugLogger.error('SendMessageTool execution failed', e);
      return {
        llmContent: `Unexpected error: ${e.message}`,
        returnDisplay: 'Unexpected messaging error.',
        error: { message: e.message, type: ToolErrorType.UNKNOWN },
      };
    }
  }

  private missingEnv(envVar: string): SendMessageToolResult {
    return {
      llmContent: `Error: Missing required environment variable: ${envVar}`,
      returnDisplay: `Missing env var: ${envVar}`,
      error: { message: `Missing env var: ${envVar}`, type: ToolErrorType.UNKNOWN },
    };
  }

  private missingParam(hint: string): SendMessageToolResult {
    return {
      llmContent: `Error: Missing required parameter. ${hint}`,
      returnDisplay: 'Missing parameter.',
      error: { message: hint, type: ToolErrorType.UNKNOWN },
    };
  }

  override getDescription(): string {
    const { action, target, message } = this.params;
    if (action === 'list') return 'Listing available messaging targets';
    return `Sending message to ${target}: "${message?.slice(0, 50)}${(message?.length ?? 0) > 50 ? '...' : ''}"`;
  }
}

// ─── Tool Class ───────────────────────────────────────────────────────────────

export class SendMessageTool extends BaseDeclarativeTool<SendMessageToolParams, SendMessageToolResult> {
  static readonly Name = 'send_message';

  constructor(messageBus: MessageBus) {
    super(
      SendMessageTool.Name,
      'Send Message',
      [
        'Send a message to a connected messaging platform (Telegram, Discord, Slack, Signal, WhatsApp), or list available targets.',
        '',
        'IMPORTANT: When the user asks to send to a specific channel or person',
        '(not just a bare platform name like "telegram"), call send_message(action="list") FIRST',
        'to see available targets, then send to the correct one.',
        '',
        'If the user just says a platform name like "send to telegram", send directly',
        'to the home channel (TELEGRAM_CHAT_ID env var) without listing first.',
        '',
        'Target format examples:',
        '  "telegram"                     → home Telegram channel',
        '  "telegram:-1001234567890:17585" → Telegram topic thread',
        '  "discord:999888777"            → Discord channel by ID',
        '  "discord:999888777:555444333"  → Discord thread',
        '  "slack:#engineering"           → Slack channel by name',
        '  "signal:+15551234567"          → Signal contact',
      ].join('\n'),
      Kind.Execute,
      {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['send', 'list'],
            description: 'Action to perform. "send" (default) sends a message. "list" returns all available channels/contacts across connected platforms.',
          },
          target: {
            type: 'string',
            description:
              'Delivery target. Format: "platform", "platform:chat_id", or "platform:chat_id:thread_id". Examples: "telegram", "discord:123456", "slack:#general", "signal:+1555..."',
          },
          message: {
            type: 'string',
            description: 'The message text to send. Supports Markdown for platforms that render it (Telegram, Slack, Discord).',
          },
        },
        required: ['action'],
      },
      messageBus,
    );
  }

  protected createInvocation(
    params: SendMessageToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
  ): ToolInvocation<SendMessageToolParams, SendMessageToolResult> {
    return new SendMessageToolInvocation(
      params,
      messageBus,
      _toolName ?? this.name,
      _toolDisplayName ?? this.displayName,
      _kind,
      [], // Messaging is off-disk
    );
  }
}
