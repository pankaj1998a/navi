import type { AssistantMessage, Part, UserMessage } from "@navi-ai/sdk/v2"
import { Locale } from "@/util/locale"

type ResponseAwareTextPart = Part & {
  type: "text"
  response?: {
    status?: string
    summary?: string
    nextStep?: string
    blockedReason?: string
    kind?: string
    confidence?: number
    answer?: string
    question?: {
      why?: string
      recommendedOption?: string
      impact?: string
      expectedNextStep?: string
      options?: Array<{ label: string }>
    }
  }
}

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
}

export type SessionInfo = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export type MessageWithParts = {
  info: UserMessage | AssistantMessage
  parts: Part[]
}

export function formatTranscript(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions,
): string {
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  for (const msg of messages) {
    transcript += formatMessage(msg.info, msg.parts, options)
    transcript += `---\n\n`
  }

  return transcript
}

export function formatMessage(msg: UserMessage | AssistantMessage, parts: Part[], options: TranscriptOptions): string {
  let result = ""

  if (msg.role === "user") {
    result += `## User\n\n`
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata)
  }

  for (const part of parts) {
    result += formatPart(part, options)
  }

  return result
}

export function formatAssistantHeader(msg: AssistantMessage, includeMetadata: boolean): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""

  return `## Assistant (${Locale.titlecase(msg.agent)} · ${msg.modelID}${duration ? ` · ${duration}` : ""})\n\n`
}

export function formatPart(part: Part, options: TranscriptOptions): string {
  if (part.type === "text" && !part.synthetic) {
    const responsePart = part as ResponseAwareTextPart
    if (responsePart.response) {
      const response = responsePart.response
      const sections: string[] = []
      const heading = response.kind ? `## ${response.kind.charAt(0).toUpperCase() + response.kind.slice(1)}` : undefined
      if (heading) sections.push(heading)

      if (response.status === "asking" && response.question) {
        const question = response.question
        const lines: string[] = []
        if (question.why) lines.push(`Why: ${question.why}`)
        if (question.impact) lines.push(`Impact: ${question.impact}`)
        if (question.recommendedOption) lines.push(`Recommended: ${question.recommendedOption}`)
        if (question.expectedNextStep) lines.push(`Next step: ${question.expectedNextStep}`)
        const optionsSummary = question.options?.map((option: { label: string }) => option.label).join(", ")
        if (optionsSummary) lines.push(`Options: ${optionsSummary}`)
        sections.push(`### Question\n\n${question.text}\n\n${lines.join("\n")}`.trim())
      }

      if (response.answer) {
        sections.push(`### Outcome\n\n${response.answer.trim()}`)
      } else if (part.text.trim()) {
        sections.push(`### Outcome\n\n${part.text.trim()}`)
      }

      if (response.summary) {
        sections.push(`### Summary\n\n${response.summary.trim()}`)
      }

      if (response.nextStep) {
        sections.push(`### Next Step\n\n${response.nextStep.trim()}`)
      }

      if (response.blockedReason) {
        sections.push(`### Blocked\n\n${response.blockedReason.trim()}`)
      }

      if (response.confidence !== undefined) {
        sections.push(`Confidence: ${Math.round(response.confidence * 100)}%`)
      }

      if (sections.length > 0) {
        return `${sections.filter(Boolean).join("\n\n")}\n\n`
      }
    }
    return `${part.text}\n\n`
  }

  if (part.type === "reasoning") {
    if (options.thinking) {
      return `_Thinking:_\n\n${part.text}\n\n`
    }
    return ""
  }

  if (part.type === "tool") {
    let result = `\`\`\`\nTool: ${part.tool}\n`
    if (options.toolDetails && part.state.input) {
      result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\``
    }
    if (options.toolDetails && part.state.status === "completed" && part.state.output) {
      result += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\``
    }
    if (options.toolDetails && part.state.status === "error" && part.state.error) {
      result += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\``
    }
    result += `\n\`\`\`\n\n`
    return result
  }

  return ""
}
