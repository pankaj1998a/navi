/**
 * Advisory tool call loop hygiene detector inspired by DeepSeek Harness (dsh-guard).
 * Tracks consecutive identical tool calls per session & agent and injects advisory
 * reminders into tool outputs to break doom loops before permissions escalate.
 */

interface ChainState {
  key: string
  count: number
  updatedAt: number
}

const MAX_CHAIN_ENTRIES = 5000
const sessionChains = new Map<string, ChainState>()

function pruneChainsIfNeeded(): void {
  if (sessionChains.size <= MAX_CHAIN_ENTRIES) return
  // Evict the oldest 20% of entries
  const toEvict = Math.ceil(MAX_CHAIN_ENTRIES * 0.2)
  let count = 0
  for (const key of sessionChains.keys()) {
    sessionChains.delete(key)
    count++
    if (count >= toEvict) break
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  if (typeof value === "string") {
    return value.trim()
  }
  return value
}

function canonicalize(args: unknown): string {
  try {
    return JSON.stringify(sortJsonValue(args))
  } catch {
    return String(args).trim()
  }
}

/**
 * Applies repeat-tool loop detection. If a tool call with identical arguments
 * is executed consecutively 3+ times in the same session and agent context,
 * appends an escalating loop hygiene warning to the tool output.
 */
export function applyToolGuard(input: {
  toolId: string
  sessionID: string
  agent: string
  args: unknown
  output: string
}): string {
  if (!input.sessionID || !input.agent) return input.output

  const sessionKey = `${input.sessionID}:${input.agent}`
  const canonical = canonicalize(input.args)
  const callKey = `${input.toolId}:${canonical}`

  pruneChainsIfNeeded()

  const current = sessionChains.get(sessionKey)
  const count = current && current.key === callKey ? current.count + 1 : 1
  sessionChains.set(sessionKey, { key: callKey, count, updatedAt: Date.now() })

  if (count < 3) return input.output

  let reminder: string
  if (count === 3) {
    reminder = `\n\n[System Guard Note: You are repeating the exact same tool call ("${input.toolId}") with identical arguments. Carefully analyze the previous output before invoking it again. If the task is incomplete, try a different approach or different parameters instead of repeating identical calls.]`
  } else if (count < 6) {
    reminder = `\n\n[System Guard Note: Repeated tool call detected (${input.toolId} × ${count}). These repeated calls are not making progress. Do not call this tool with these exact arguments again. Inspect the latest results and choose a different action or parameters.]`
  } else {
    reminder = `\n\n[System Guard Critical: Infinite loop detected (${input.toolId} × ${count}). You have repeatedly executed this identical action without making progress. Stop repeating this operation immediately. Explain the roadblock to the user or take an entirely different recovery path.]`
  }

  return input.output + reminder
}

/**
 * Resets tracking state for a given session.
 */
export function resetToolGuard(sessionID?: string): void {
  if (!sessionID) {
    sessionChains.clear()
    return
  }
  for (const key of sessionChains.keys()) {
    if (key.startsWith(`${sessionID}:`)) {
      sessionChains.delete(key)
    }
  }
}

