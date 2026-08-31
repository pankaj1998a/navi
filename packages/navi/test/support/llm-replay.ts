import * as Stream from "effect/Stream"
import { Effect, Layer } from "effect"
import { LLM, type StreamInput, type Event } from "@/session/llm"

export interface ReplayStep {
  text?: string
  toolCalls?: Array<{
    toolCallId: string
    toolName: string
    args: Record<string, unknown>
  }>
  finishReason?: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

export interface ReplayTranscript {
  steps: ReplayStep[]
}

export interface ReplayHandle {
  layer: Layer.Layer<LLM.Service>
  calls: StreamInput[]
  assertConsumed: () => void
  dispose: () => void
}

export interface InstallReplayOptions {
  transcript: ReplayTranscript | ReplayStep[] | string
  paceMs?: number
}

/**
 * Parses durable session JSONL log into replay steps.
 */
export function parseSessionJsonl(jsonlContent: string): ReplayStep[] {
  const lines = jsonlContent.split("\n").filter((l) => l.trim().length > 0)
  const steps: ReplayStep[] = []

  for (const line of lines) {
    try {
      const record = JSON.parse(line)
      if (record.role === "assistant" || record.type === "assistant" || record.info?.role === "assistant") {
        const textParts = (record.parts || []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("")
        const toolParts = (record.parts || [])
          .filter((p: any) => p.type === "tool" || p.type === "tool-call")
          .map((p: any) => ({
            toolCallId: p.callID || p.id || "tool-call",
            toolName: p.tool || p.name || "tool",
            args: p.state?.input || p.args || {},
          }))

        steps.push({
          text: textParts || undefined,
          toolCalls: toolParts.length > 0 ? toolParts : undefined,
          finishReason: record.finish || "stop",
          usage: record.tokens
            ? {
                promptTokens: record.tokens.input || 10,
                completionTokens: record.tokens.output || 20,
              }
            : undefined,
        })
      }
    } catch {
      // Ignore non-json header rows
    }
  }

  if (steps.length === 0) {
    steps.push({ text: "Replay session initialized", finishReason: "stop" })
  }

  return steps
}

/**
 * Creates an offline LLM replay provider for unit and integration testing.
 * Replays pre-recorded model responses from transcripts or JSONL logs without making any network requests.
 */
export function createReplayLlm(transcript: ReplayTranscript | ReplayStep[] | string): ReplayHandle {
  const steps: ReplayStep[] = typeof transcript === "string"
    ? parseSessionJsonl(transcript)
    : Array.isArray(transcript)
      ? [...transcript]
      : [...transcript.steps]

  const calls: StreamInput[] = []
  let stepIndex = 0

  const service: LLM.Interface = {
    stream: (input: StreamInput) => {
      calls.push(input)
      const currentStep = steps[stepIndex] ?? { text: "Replay step complete", finishReason: "stop" }
      stepIndex++

      const events: Event[] = []

      // 1. Text deltas
      if (currentStep.text) {
        events.push({
          type: "text-delta",
          text: currentStep.text,
          id: `chunk-${stepIndex}`,
        } as unknown as Event)
      }

      // 2. Tool calls
      if (currentStep.toolCalls) {
        for (const tc of currentStep.toolCalls) {
          events.push({
            type: "tool-call",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.args,
          } as unknown as Event)
        }
      }

      // 3. Finish event
      events.push({
        type: "finish",
        finishReason: currentStep.finishReason ?? "stop",
        usage: currentStep.usage ?? { promptTokens: 10, completionTokens: 20 },
      } as unknown as Event)

      return Stream.fromIterable(events)
    },
  }

  return {
    layer: Layer.succeed(LLM.Service, service),
    calls,
    assertConsumed: () => {
      if (stepIndex < steps.length) {
        throw new Error(`LLM Replay underrun: only consumed ${stepIndex} of ${steps.length} recorded steps`)
      }
    },
    dispose: () => {
      // Teardown hook
    },
  }
}

/**
 * High-level helper matching dsh installLlmReplay contract.
 */
export function installLlmReplay(
  options: InstallReplayOptions | ReplayStep[] | ReplayTranscript | string,
): ReplayHandle {
  if (typeof options === "string" || Array.isArray(options)) {
    return createReplayLlm(options)
  }
  if ("transcript" in options) {
    return createReplayLlm(options.transcript)
  }
  return createReplayLlm(options)
}
