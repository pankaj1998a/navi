import { Effect } from "effect"
import type { WithParts } from "./message-v2"

export type { WithParts } from "./message-v2"

export type MessageWithParts = WithParts

export type SurfaceOp = "append" | { op: "replace"; start: number; end: number }

export type SurfaceState = {
  nodes: number[]
  replaceGeneration: number
}

type SurfaceMessage = WithParts & {
  surfaceOp?: unknown
  sourceEventSeqs?: unknown
}

const isEventSeq = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0

const isReplaceOp = (value: object): value is Extract<SurfaceOp, { op: "replace" }> => {
  const op = value as Record<string, unknown>
  if (Object.keys(op).length !== 3) return false
  if (!Object.hasOwn(op, "op")) return false
  if (!Object.hasOwn(op, "start")) return false
  if (!Object.hasOwn(op, "end")) return false
  if (op["op"] !== "replace") return false
  if (!isEventSeq(op["start"])) return false
  if (!isEventSeq(op["end"])) return false
  return true
}

const isDeepEqualJson = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((item, i) => isDeepEqualJson(item, b[i]))
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  const aKeys = Object.keys(a)
  const bRecord = b as Record<string, unknown>
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every((key) => Object.hasOwn(b, key) && isDeepEqualJson((a as Record<string, unknown>)[key], bRecord[key]))
}

export const isSurfaceEvent = (msg: WithParts): boolean => {
  if (msg.parts.length === 0) return false
  if (msg.info.role === "user" && msg.parts.some((p) => p.type === "compaction")) return false
  return msg.info.role === "user" || msg.info.role === "assistant"
}

export const isReplacementSurfaceEvent = (op: SurfaceOp): op is Extract<SurfaceOp, { op: "replace" }> =>
  typeof op !== "string" && op.op === "replace"

export const surfaceOpOf = (msg: SurfaceMessage): SurfaceOp | undefined => {
  const raw = msg as SurfaceMessage
  if (!isSurfaceEvent(msg)) {
    if (raw.surfaceOp !== undefined) throw new Error(`message ${msg.info.id} is not surface-eligible and cannot carry surfaceOp`)
    if (raw.sourceEventSeqs !== undefined) throw new Error(`message ${msg.info.id} is not surface-eligible and cannot carry sourceEventSeqs`)
    return undefined
  }
  const op = raw.surfaceOp
  if (op === undefined) throw new Error(`surface-eligible message ${msg.info.id} requires surfaceOp`)
  if (op === "append") return op
  if (op === null || typeof op !== "object" || Array.isArray(op)) throw new Error(`message ${msg.info.id} carries invalid surfaceOp`)
  if (!isReplaceOp(op as object)) throw new Error(`message ${msg.info.id} carries invalid replace surfaceOp`)
  return op as SurfaceOp
}

export const assertProvenance = (msg: SurfaceMessage, shadowedSeqs: readonly number[]): void => {
  const raw = msg.sourceEventSeqs
  const sources = new Set<number>()
  if (raw !== undefined) {
    if (!Array.isArray(raw)) throw new Error(`sourceEventSeqs on ${msg.info.id} must be an array when present`)
    if (raw.length === 0 && msg.info.role !== "assistant") throw new Error("sourceEventSeqs must not be empty except on assistant message")
    let nonEarlier: number | undefined
    for (const source of raw) {
      if (!isEventSeq(source)) throw new Error(`sourceEventSeqs must densely contain non-negative safe integers`)
      sources.add(source)
      if (nonEarlier === undefined) {
        const seq = (msg as SurfaceMessage & { seq?: unknown }).seq
        if (typeof seq === "number" && source >= seq) nonEarlier = source
      }
    }
    if (sources.size !== (raw as unknown[]).length) throw new Error("sourceEventSeqs must not contain duplicates")
    if (nonEarlier !== undefined) throw new Error(`sourceEventSeqs must reference earlier seqs: ${nonEarlier}`)
  }
  const missing = shadowedSeqs.filter((seq) => !sources.has(seq))
  if (missing.length > 0) throw new Error(`surface replace: sourceEventSeqs must include every shadowed node; missing ${missing.join(", ")}`)
}

export const assertToolResultRewrite = (
  msg: WithParts,
  shadowed: readonly WithParts[],
  shadowedSeqs: readonly number[],
): void => {
  const isTool = msg.parts.some((p) => p.type === "tool")
  if (!isTool) return
  if (shadowedSeqs.length !== 1) throw new Error("tool surface replacement must rewrite exactly one current node")
  for (let i = 0; i < shadowed.length; i++) {
    const original = shadowed[i]
    if (!original) continue
    if (!original.parts.some((p) => p.type === "tool")) throw new Error("tool surface replacement must target a tool node")
    const originalTool = original.parts.find((p) => p.type === "tool")
    const replacementTool = msg.parts.find((p) => p.type === "tool")
    if (!originalTool || !replacementTool) continue
    const o = { ...originalTool } as Record<string, unknown>
    const r = { ...replacementTool } as Record<string, unknown>
    o["state"] = { ...(o["state"] as object), output: null }
    r["state"] = { ...(r["state"] as object), output: null }
    if (!isDeepEqualJson(o, r)) throw new Error("tool surface replacement may change only content")
  }
}

export const deriveEventMessage = (msg: WithParts): WithParts | null => {
  if (!isSurfaceEvent(msg)) return null
  if (msg.info.role === "assistant") {
    const hasContent = msg.parts.some((p) => p.type === "text" && p.text.trim().length > 0 || p.type === "tool" || p.type === "reasoning" || p.type === "file")
    if (!hasContent) return null
  }
  return msg
}

export const foldSurface = (entries: readonly { seq: number; op: SurfaceOp }[]): SurfaceState =>
  Effect.gen(function* () {
    const state: SurfaceState = { nodes: [], replaceGeneration: 0 }
    for (const entry of entries) {
      if (!isEventSeq(entry.seq)) throw new Error(`invalid seq ${entry.seq}`)
      if (entry.op === "append") {
        state.nodes.push(entry.seq)
        continue
      }
      const idxStart = state.nodes.indexOf(entry.op.start)
      if (idxStart === -1) throw new Error(`surface replace: start seq ${entry.op.start} not found`)
      const idxEnd = state.nodes.indexOf(entry.op.end)
      if (idxEnd === -1) throw new Error(`surface replace: end seq ${entry.op.end} not found`)
      if (idxStart > idxEnd) throw new Error(`surface replace: start after end`)
      state.nodes.splice(idxStart, idxEnd - idxStart + 1, entry.seq)
      state.replaceGeneration += 1
    }
    return state
  }).pipe(Effect.runSync)

export class SurfaceManager {
  private _nodes: number[] = []
  private _replaceGeneration = 0
  private _lastSeq = -1

  constructor(initial?: readonly number[]) {
    if (initial) this._nodes = [...initial]
  }

  get nodes(): readonly number[] {
    return this._nodes
  }

  get replaceGeneration(): number {
    return this._replaceGeneration
  }

  get state(): SurfaceState {
    return { nodes: [...this._nodes], replaceGeneration: this._replaceGeneration }
  }

  validateNext(op: SurfaceOp, seq: number): void {
    if (!isEventSeq(seq)) throw new Error(`invalid seq ${seq}`)
    if (seq !== this._lastSeq + 1 && this._lastSeq !== -1 && seq <= this._lastSeq) throw new Error(`seq ${seq} not contiguous; expected ${this._lastSeq + 1}`)
    if (op === "append") return
    if (!isReplaceOp(op as object)) throw new Error("invalid replace op")
    const s = op.start
    const e = op.end
    if (!isEventSeq(s) || !isEventSeq(e)) throw new Error("replace start/end must be safe integers")
  }

  append(seq: number): void {
    this.validateNext("append", seq)
    this._nodes.push(seq)
    this._lastSeq = seq
  }

  replace(start: number, end: number, seq: number): void {
    const op: SurfaceOp = { op: "replace", start, end }
    this.validateNext(op, seq)
    const startIdx = this._nodes.indexOf(start)
    if (startIdx === -1) throw new Error(`surface replace: start seq ${start} not found`)
    const endIdx = this._nodes.indexOf(end)
    if (endIdx === -1) throw new Error(`surface replace: end seq ${end} not found`)
    if (startIdx > endIdx) throw new Error(`surface replace: start after end`)
    this._nodes.splice(startIdx, endIdx - startIdx + 1, seq)
    this._replaceGeneration += 1
    this._lastSeq = seq
  }

  fold(nodes: readonly number[]): SurfaceState {
    const gen = this._replaceGeneration
    return Effect.gen(function* () {
      const out: SurfaceState = { nodes: [...nodes], replaceGeneration: gen }
      return out
    }).pipe(Effect.runSync)
  }

  assertProvenance(msg: SurfaceMessage, shadowedSeqs: readonly number[]): void {
    return assertProvenance(msg, shadowedSeqs)
  }

  assertToolResultRewrite(msg: WithParts, shadowed: readonly WithParts[], shadowedSeqs: readonly number[]): void {
    return assertToolResultRewrite(msg, shadowed, shadowedSeqs)
  }
}

export * as Surface from "./surface"
