/**
 * Ported from SpaceXAI Grok Build (xai-prompt-queue combine.rs)
 *
 * Provides pure prompt-queue combining rules so consecutive user follow-ups
 * arriving during runner execution or multiple messages queued before the next
 * agent step are merged into a single cohesive turn instead of fragmented calls.
 */

import type { MessageV2 } from "./message-v2"

export const TEXT_SEPARATOR = "\n\n"
export const COMBINED_DISPLAY_TEXTS_META = "combined_display_texts"

export interface CombineGate {
  id: string
  isPlainPrompt: boolean
  isSynthetic: boolean
  isExpandedSkill: boolean
  isBash: boolean
  hasImages: boolean
  text: string
}

/**
 * Gate check for the front (first) message of a combinable batch:
 * must be a plain user prompt, not synthetic, not expanded skill, not bash, with non-empty text.
 */
export function canMergeFront(gate: CombineGate): boolean {
  return (
    gate.isPlainPrompt &&
    !gate.isSynthetic &&
    !gate.isExpandedSkill &&
    !gate.isBash &&
    gate.text.trim().length > 0
  )
}

/**
 * Gate check for follower messages in the combinable batch:
 * same as front, but additionally must have no images and not be in skipIds (e.g. edited/held).
 */
export function canMergeFollower(gate: CombineGate, skipIds: ReadonlySet<string> = new Set()): boolean {
  return canMergeFront(gate) && !gate.hasImages && !skipIds.has(gate.id)
}

/**
 * Computes how many consecutive gates from the front can be merged.
 * Returns 0 if empty, 1 if front cannot merge with any followers, or N if N items can merge.
 */
export function combinePrefixLen(items: CombineGate[], skipIds: ReadonlySet<string> = new Set()): number {
  if (items.length === 0) return 0
  const front = items[0]
  if (!front || !canMergeFront(front)) return 1

  let count = 1
  for (let i = 1; i < items.length; i++) {
    const next = items[i]
    if (!next || !canMergeFollower(next, skipIds)) {
      break
    }
    count++
  }
  return count
}

/**
 * Joins multiple text segments with standard double-newline separator.
 */
export function joinTexts(texts: readonly string[]): string {
  return texts
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join(TEXT_SEPARATOR)
}

/**
 * Extracts a CombineGate from a MessageV2.WithParts user message.
 */
export function gateFromMessage(message: MessageV2.WithParts): CombineGate {
  const isPlainPrompt = message.info.role === "user"
  const isSynthetic = message.parts.some((p) => "synthetic" in p && Boolean((p as { synthetic?: boolean }).synthetic))
  const isExpandedSkill = message.parts.some((p) => p.type === "subtask")
  const isBash = message.parts.some((p) => p.type === "tool" && p.tool === "bash")
  const hasImages = message.parts.some((p) => p.type === "file" && "media" in p && (p as { media?: string }).media === "image")
  const textParts = message.parts
    .filter((p): p is MessageV2.TextPart => p.type === "text" && !p.ignored)
    .map((p) => p.text)
  const text = textParts.join("\n")

  return {
    id: message.info.id,
    isPlainPrompt,
    isSynthetic,
    isExpandedSkill,
    isBash,
    hasImages,
    text,
  }
}

/**
 * Combines an array of consecutive user follow-up texts into a single formatted system reminder.
 * When multiple follow-up messages are received, merges them into a clean multi-part prompt
 * to save tokens and avoid repetitive <system-reminder> wrappers.
 */
export function formatFollowupReminders(messages: MessageV2.WithParts[], lastFinishedId?: string): string | undefined {
  const eligibleTexts: string[] = []

  for (const m of messages) {
    if (m.info.role !== "user") continue
    if (lastFinishedId && m.info.id <= lastFinishedId) continue

    const gate = gateFromMessage(m)
    if (gate.isPlainPrompt && !gate.isSynthetic && !gate.isBash && gate.text.trim()) {
      eligibleTexts.push(gate.text.trim())
    }
  }

  if (eligibleTexts.length === 0) return undefined

  if (eligibleTexts.length === 1) {
    return [
      "<system-reminder>",
      "The user sent the following message:",
      eligibleTexts[0],
      "",
      "Please address this message and continue with your tasks.",
      "</system-reminder>",
    ].join("\n")
  }

  // Merged prompt from Grok Build combine logic
  return [
    "<system-reminder>",
    `The user sent ${eligibleTexts.length} follow-up messages:`,
    joinTexts(eligibleTexts),
    "",
    "Please address all of the user's instructions above in order and continue with your tasks.",
    "</system-reminder>",
  ].join("\n")
}

import { ulid } from "ulid"
import { Context, Effect, Layer } from "effect"
import { InstanceState } from "@/effect/instance-state"

export interface QueuedPromptItem {
  id: string
  sessionId: string
  text: string
  createdAt: number
}

export interface Interface {
  readonly enqueue: (sessionID: string, text: string) => Effect.Effect<QueuedPromptItem>
  readonly dequeue: (sessionID: string) => Effect.Effect<QueuedPromptItem | undefined>
  readonly peek: (sessionID: string) => Effect.Effect<QueuedPromptItem | undefined>
  readonly hasQueued: (sessionID: string) => Effect.Effect<boolean>
  readonly getQueue: (sessionID: string) => Effect.Effect<readonly QueuedPromptItem[]>
  readonly drainMerged: (sessionID: string) => Effect.Effect<string | undefined>
  readonly clear: (sessionID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@navi/SessionPromptQueue") {}

/**
 * InstanceState-backed SessionPromptQueue Layer.
 * Ported from SpaceXAI Grok Build (xai-prompt-queue).
 * Lifecycle-bound to the active Instance directory with automatic finalizer cleanup and LRU/TTL eviction.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(
      Effect.fn("SessionPromptQueue.state")(function* () {
        const queues = new Map<string, QueuedPromptItem[]>()
        const lastAccess = new Map<string, number>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            queues.clear()
            lastAccess.clear()
          }),
        )
        return { queues, lastAccess }
      }),
    )

    const MAX_SESSIONS = 256
    const TTL_MS = 2 * 60 * 60 * 1000

    const evictStale = (queues: Map<string, QueuedPromptItem[]>, lastAccess: Map<string, number>) => {
      const now = Date.now()
      for (const [sid, lastTime] of lastAccess.entries()) {
        if (now - lastTime > TTL_MS) {
          queues.delete(sid)
          lastAccess.delete(sid)
        }
      }
      if (queues.size > MAX_SESSIONS) {
        const oldest = [...lastAccess.entries()].sort((a, b) => a[1] - b[1])[0]
        if (oldest) {
          queues.delete(oldest[0])
          lastAccess.delete(oldest[0])
        }
      }
    }

    const enqueue = Effect.fn("SessionPromptQueue.enqueue")(function* (sessionID: string, text: string) {
      const data = yield* InstanceState.get(state)
      evictStale(data.queues, data.lastAccess)
      data.lastAccess.set(sessionID, Date.now())

      const item: QueuedPromptItem = {
        id: `pq_${ulid()}`,
        sessionId: sessionID,
        text: text.trim(),
        createdAt: Date.now(),
      }
      const current = data.queues.get(sessionID) ?? []
      current.push(item)
      data.queues.set(sessionID, current)
      return item
    })

    const dequeue = Effect.fn("SessionPromptQueue.dequeue")(function* (sessionID: string) {
      const data = yield* InstanceState.get(state)
      data.lastAccess.set(sessionID, Date.now())
      const current = data.queues.get(sessionID)
      if (!current || current.length === 0) return undefined
      const item = current.shift()
      if (current.length === 0) {
        data.queues.delete(sessionID)
        data.lastAccess.delete(sessionID)
      }
      return item
    })

    const peek = Effect.fn("SessionPromptQueue.peek")(function* (sessionID: string) {
      const data = yield* InstanceState.get(state)
      data.lastAccess.set(sessionID, Date.now())
      return data.queues.get(sessionID)?.[0]
    })

    const hasQueued = Effect.fn("SessionPromptQueue.hasQueued")(function* (sessionID: string) {
      const data = yield* InstanceState.get(state)
      return (data.queues.get(sessionID)?.length ?? 0) > 0
    })

    const getQueue = Effect.fn("SessionPromptQueue.getQueue")(function* (sessionID: string) {
      const data = yield* InstanceState.get(state)
      return (data.queues.get(sessionID) ?? []) as readonly QueuedPromptItem[]
    })

    const drainMerged = Effect.fn("SessionPromptQueue.drainMerged")(function* (sessionID: string) {
      const data = yield* InstanceState.get(state)
      const items = data.queues.get(sessionID)
      if (!items || items.length === 0) return undefined
      data.queues.delete(sessionID)
      data.lastAccess.delete(sessionID)
      const texts = items.map((i) => i.text).filter((t) => t.length > 0)
      if (texts.length === 0) return undefined
      if (texts.length === 1) return texts[0]
      return joinTexts(texts)
    })

    const clear = Effect.fn("SessionPromptQueue.clear")(function* (sessionID: string) {
      const data = yield* InstanceState.get(state)
      data.queues.delete(sessionID)
      data.lastAccess.delete(sessionID)
    })

    return Service.of({ enqueue, dequeue, peek, hasQueued, getQueue, drainMerged, clear })
  }),
)

export const defaultLayer = layer

/**
 * Synchronous standalone adapter for non-Effect contexts.
 */
export class SessionPromptQueue {
  private queues: Map<string, QueuedPromptItem[]> = new Map()
  private lastAccess: Map<string, number> = new Map()
  private readonly MAX_SESSIONS = 256
  private readonly TTL_MS = 2 * 60 * 60 * 1000

  private evictStale(): void {
    const now = Date.now()
    for (const [sid, lastTime] of this.lastAccess.entries()) {
      if (now - lastTime > this.TTL_MS) {
        this.queues.delete(sid)
        this.lastAccess.delete(sid)
      }
    }
    if (this.queues.size > this.MAX_SESSIONS) {
      const oldest = [...this.lastAccess.entries()].sort((a, b) => a[1] - b[1])[0]
      if (oldest) {
        this.queues.delete(oldest[0])
        this.lastAccess.delete(oldest[0])
      }
    }
  }

  enqueue(sessionId: string, text: string): QueuedPromptItem {
    this.evictStale()
    this.lastAccess.set(sessionId, Date.now())

    const item: QueuedPromptItem = {
      id: `pq_${ulid()}`,
      sessionId,
      text: text.trim(),
      createdAt: Date.now(),
    }
    const current = this.queues.get(sessionId) ?? []
    current.push(item)
    this.queues.set(sessionId, current)
    return item
  }

  dequeue(sessionId: string): QueuedPromptItem | undefined {
    this.lastAccess.set(sessionId, Date.now())
    const current = this.queues.get(sessionId)
    if (!current || current.length === 0) return undefined
    const item = current.shift()
    if (current.length === 0) {
      this.queues.delete(sessionId)
      this.lastAccess.delete(sessionId)
    }
    return item
  }

  peek(sessionId: string): QueuedPromptItem | undefined {
    this.lastAccess.set(sessionId, Date.now())
    return this.queues.get(sessionId)?.[0]
  }

  hasQueued(sessionId: string): boolean {
    const current = this.queues.get(sessionId)
    return !!current && current.length > 0
  }

  getQueue(sessionId: string): readonly QueuedPromptItem[] {
    return this.queues.get(sessionId) ?? []
  }

  drainMerged(sessionId: string): string | undefined {
    const items = this.queues.get(sessionId)
    if (!items || items.length === 0) return undefined
    this.queues.delete(sessionId)
    this.lastAccess.delete(sessionId)
    const texts = items.map((i) => i.text).filter((t) => t.length > 0)
    if (texts.length === 0) return undefined
    if (texts.length === 1) return texts[0]
    return joinTexts(texts)
  }

  clear(sessionId: string): void {
    this.queues.delete(sessionId)
    this.lastAccess.delete(sessionId)
  }
}

export const PromptQueue = new SessionPromptQueue()

