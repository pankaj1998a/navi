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
  const isSynthetic = message.parts.some((p) => (p as any).synthetic === true)
  const isExpandedSkill = message.parts.some((p) => (p as any).type === "skill")
  const isBash = message.parts.some((p) => (p as any).type === "bash" || (p as any).type === "command")
  const hasImages = message.parts.some((p) => p.type === "file" && (p as any).media === "image")
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
