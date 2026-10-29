/**
 * Compaction Recovery & Context Recap Protocol
 * Ported from ai-memory's compaction recovery engine.
 * When conversation context is compacted, reconstructs the stretch dropped between
 * the compaction boundaries (user prompts, pending handoffs, latest observations)
 * so the agent recovers exact details lost during compaction.
 */

import { listHandoffs } from "./handoff"
import { listWikiPages } from "./wiki"

export interface CompactionRecapInput {
  session_id?: string
  target_directory?: string
  project?: string
  recent_prompts?: string[]
  last_assistant_reply?: string
}

export interface CompactionRecapResult {
  has_recap: boolean
  recap_text: string
  open_handoffs_count: number
}

export function buildCompactionRecap(input: CompactionRecapInput): CompactionRecapResult {
  const lines: string[] = [
    "=== Context Recap (Compaction Recovery) ===",
    "This recap recovers critical context and prompts preserved across recent compaction.",
    "",
  ]

  // 1. Prompts in this stretch
  if (input.recent_prompts && input.recent_prompts.length > 0) {
    lines.push("### User Prompts in Pre-Compaction Stretch (Oldest First):")
    for (let i = 0; i < input.recent_prompts.length; i++) {
      lines.push(`${i + 1}. ${input.recent_prompts[i]}`)
    }
    lines.push("")
  }

  // 2. Last assistant reply if available
  if (input.last_assistant_reply) {
    lines.push("### Last Assistant State Before Compaction:")
    lines.push(input.last_assistant_reply.slice(0, 500) + (input.last_assistant_reply.length > 500 ? "..." : ""))
    lines.push("")
  }

  // 3. Open project handoffs (listed, never claimed)
  const openHandoffs = listHandoffs({
    target_directory: input.target_directory,
    status: "open",
  })

  lines.push(`### Open Project Handoffs (${openHandoffs.length} pending):`)
  if (openHandoffs.length === 0) {
    lines.push("- (none)")
  } else {
    for (const h of openHandoffs) {
      lines.push(`- **Handoff ID**: \`${h.id}\` (Owner: ${h.owner}, Created: ${h.created_at})`)
      lines.push(`  - Summary: ${h.summary}`)
      if (h.next_steps.length > 0) {
        lines.push(`  - Next Steps: ${h.next_steps.join("; ")}`)
      }
      if (h.open_questions.length > 0) {
        lines.push(`  - Open Questions: ${h.open_questions.join("; ")}`)
      }
    }
  }
  lines.push("")

  // 4. Relevant high-confidence project rules
  const rules = listWikiPages({ kind: "rule" })
  if (rules.length > 0) {
    lines.push("### Active Project Rules:")
    for (const r of rules.slice(0, 5)) {
      lines.push(`- **${r.title}**: ${r.body.slice(0, 150)}...`)
    }
    lines.push("")
  }

  lines.push("===========================================")

  return {
    has_recap: true,
    recap_text: lines.join("\n"),
    open_handoffs_count: openHandoffs.length,
  }
}
