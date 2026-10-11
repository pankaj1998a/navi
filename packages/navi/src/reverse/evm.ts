import { Schema } from "effect"
import { unknown, type Unknown } from "./evidence"

export const EvmAnalysis = Schema.Struct({
  bytes: Schema.Number,
  selectors: Schema.Array(Schema.String),
  payable: Schema.String,
  metadata: Schema.optional(Schema.String),
  solc: Schema.optional(Schema.String),
  unknowns: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      message: Schema.String,
      path: Schema.optional(Schema.String),
    }),
  ),
})

export type EvmAnalysis = Schema.Schema.Type<typeof EvmAnalysis>

class Cut extends Error {}

export const decodeEvmCarrier = (input: Uint8Array, encoding: "raw" | "hex"): Uint8Array => {
  if (encoding === "raw") return Uint8Array.from(input)
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input)
  } catch {
    throw new Cut("Hex carrier must be valid UTF-8.")
  }
  const code = text.replace(/^[\x09-\x0d\x20]+|[\x09-\x0d\x20]+$/g, "").replace(/^0x/i, "")
  if (!/^(?:[a-fA-F0-9]{2})*$/.test(code) || code.length === 0)
    throw new Cut("Hex carrier requires complete hexadecimal byte pairs with an optional 0x prefix.")
  const out = new Uint8Array(code.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(code.slice(i * 2, i * 2 + 2), 16)
  return out
}

const PUSH_SIZES = new Map<number, number>(
  Array.from({ length: 32 }, (_, i) => [0x60 + i, i + 1] as [number, number]),
)

const findSelectors = (code: Uint8Array): string[] => {
  const found = new Set<string>()
  let i = 0
  while (i + 11 < code.length) {
    if (
      code[i] === 0x80 &&
      code[i + 1] === 0x63 &&
      code[i + 6] === 0x14 &&
      code[i + 7] === 0x61 &&
      code[i + 10] === 0x57
    ) {
      found.add(
        Array.from(code.slice(i + 2, i + 6), (b) => b.toString(16).padStart(2, "0")).join(""),
      )
      i += 11
      continue
    }
    const push = PUSH_SIZES.get(code[i] ?? 0)
    i += push === undefined ? 1 : 1 + push
  }
  return [...found].toSorted()
}

const describePayable = (code: Uint8Array): string => {
  let hasCallValue = false
  let i = 0
  while (i < Math.min(code.length, 64)) {
    if (code[i] === 0x34) {
      hasCallValue = true
      break
    }
    const push = PUSH_SIZES.get(code[i] ?? 0)
    i += push === undefined ? 1 : 1 + push
  }
  return hasCallValue
    ? "guarded (CALLVALUE checked in prologue; functions likely non-payable unless routed around it)"
    : "unguarded prologue (likely payable; no CALLVALUE gate observed)"
}

const findMetadata = (code: Uint8Array): { metadata: string; solc?: string } | undefined => {
  const hex: string[] = [...code].map((b) => (b ?? 0).toString(16).padStart(2, "0"))
  const joined = hex.join("")
  const ipfs = joined.indexOf("a264697066735822")
  const swarm = joined.indexOf("a265627a7a72305820")
  const at = ipfs >= 0 ? ipfs / 2 : swarm >= 0 ? swarm / 2 : -1
  if (at < 0) return undefined
  const tail = code.slice(at)
  const length = tail.length >= 2 ? ((tail[tail.length - 2] ?? 0) << 8) | (tail[tail.length - 1] ?? 0) : 0
  const out: { metadata: string; solc?: string } = {
    metadata: ipfs >= 0 ? "IPFS (a264) auxiliary data" : "Swarm (bzzr1) auxiliary data",
  }
  if (length > 0 && length <= tail.length) {
    const meta = tail.slice(0, tail.length - 2)
    const solcIdx = meta.findIndex((b, idx) => b === 0x73 && meta[idx + 1] === 0x6f && meta[idx + 2] === 0x6c && meta[idx + 3] === 0x63)
    if (solcIdx >= 0 && solcIdx + 7 < meta.length) {
      out.solc = `${meta[solcIdx + 4]}.${meta[solcIdx + 5]}.${meta[solcIdx + 6]}`
    }
  }
  return out
}

export const analyzeEvmBytecode = (input: Uint8Array, encoding: "raw" | "hex"): EvmAnalysis => {
  const unknowns: Unknown[] = []
  try {
    const code = decodeEvmCarrier(input, encoding)
    if (code.length === 0) return { bytes: 0, selectors: [], payable: "empty", unknowns: [unknown("format", "Empty bytecode.")] }
    const selectors = findSelectors(code)
    if (selectors.length === 0)
      unknowns.push(unknown("inference", "No standard dispatcher found; minimal proxy, hand-written assembly, or create-time init code?"))
    const meta = findMetadata(code)
    if (!meta) unknowns.push(unknown("omission", "No compiler metadata hash; source verification via Sourcify unavailable."))
    return {
      bytes: code.length,
      selectors,
      payable: describePayable(code),
      ...(meta ? { metadata: meta.metadata, ...(meta.solc ? { solc: meta.solc } : {}) } : {}),
      unknowns,
    }
  } catch (error) {
    if (error instanceof Cut) {
      return { bytes: 0, selectors: [], payable: "unknown", unknowns: [unknown("format", error.message)] }
    }
    throw error
  }
}

export * as ReverseEvm from "./evm"
