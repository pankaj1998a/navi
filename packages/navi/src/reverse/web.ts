import { Schema } from "effect"
import { unknown, type Unknown } from "./evidence"

const Count = Schema.Struct({ name: Schema.String, count: Schema.Number })

export const HarSummary = Schema.Struct({
  version: Schema.String,
  entries: Schema.Number,
  totalBytes: Schema.Number,
  statuses: Schema.Array(Count),
  mimes: Schema.Array(Count),
  domains: Schema.Array(Count),
  largest: Schema.Array(Schema.Struct({ url: Schema.String, bytes: Schema.Number })),
  failures: Schema.Array(Schema.Struct({ url: Schema.String, status: Schema.Number })),
})

export type HarSummary = Schema.Schema.Type<typeof HarSummary>

export const SourceMapSummary = Schema.Struct({
  sources: Schema.Number,
  sourcesWithContent: Schema.Number,
  names: Schema.Number,
  mappingsBytes: Schema.Number,
  generatedLines: Schema.Number,
  file: Schema.optional(Schema.String),
})

export type SourceMapSummary = Schema.Schema.Type<typeof SourceMapSummary>

export const WebAnalysis = Schema.Struct({
  kind: Schema.String,
  har: Schema.optional(HarSummary),
  sourcemap: Schema.optional(SourceMapSummary),
  unknowns: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      message: Schema.String,
      path: Schema.optional(Schema.String),
    }),
  ),
})

export type WebAnalysis = Schema.Schema.Type<typeof WebAnalysis>

class Cut extends Error {}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

const isJsonObject = (v: unknown): v is { [key: string]: Json } =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const parseJson = (text: string, what: string): unknown => {
  try {
    return JSON.parse(text.replace(/^﻿/, ""))
  } catch {
    throw new Cut(`${what} is not valid JSON.`)
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const num = (v: unknown): number => (typeof v === "number" ? v : 0)
const obj = (v: unknown): { [key: string]: Json } | undefined => (isJsonObject(v) ? v : undefined)

const top = (hist: Map<string, number>, n: number): { name: string; count: number }[] =>
  [...hist].map(([name, count]) => ({ name, count })).toSorted((a, b) => b.count - a.count).slice(0, n)

export const analyzeHar = (text: string): WebAnalysis => {
  const unknowns: Unknown[] = []
  try {
    const root = obj(parseJson(text, "HAR"))
    if (!root) throw new Cut("HAR root is not an object.")
    const log = obj(root["log"])
    if (!log) throw new Cut("HAR has no log object.")
    const entries = Array.isArray(log["entries"]) ? log["entries"] : []
    const statuses = new Map<string, number>()
    const mimes = new Map<string, number>()
    const domains = new Map<string, number>()
    const sizes: { url: string; bytes: number }[] = []
    const failures: { url: string; status: number }[] = []
    let totalBytes = 0
    let missingUrl = 0
    for (const e of entries) {
      const entry = obj(e)
      if (!entry) continue
      const request = obj(entry["request"]) ?? {}
      const response = obj(entry["response"]) ?? {}
      const url = str(request["url"]) ?? ""
      if (!url) missingUrl += 1
      const status = num(response["status"])
      statuses.set(String(status), (statuses.get(String(status)) ?? 0) + 1)
      const content = obj(response["content"]) ?? {}
      const mime = str(content["mimeType"]) ?? "unknown"
      mimes.set(mime, (mimes.get(mime) ?? 0) + 1)
      const size = num(content["bodySize"]) >= 0 ? num(content["bodySize"]) : num(content["size"])
      if (size > 0) {
        totalBytes += size
        sizes.push({ url: url.slice(0, 160), bytes: size })
      }
      if (status >= 400 || status === 0) failures.push({ url: url.slice(0, 160), status })
      try {
        const host = new URL(url).host
        if (host) domains.set(host, (domains.get(host) ?? 0) + 1)
      } catch {
        // unparseable url, skip domain bucket
      }
    }
    sizes.sort((a, b) => b.bytes - a.bytes)
    if (missingUrl > 0) unknowns.push(unknown("omission", `${missingUrl} entries lack request URLs.`))
    if (entries.length === 0) unknowns.push(unknown("omission", "HAR log has no entries."))
    return {
      kind: "har",
      har: {
        version: str(log["version"]) ?? "unknown",
        entries: entries.length,
        totalBytes,
        statuses: top(statuses, 12),
        mimes: top(mimes, 12),
        domains: top(domains, 15),
        largest: sizes.slice(0, 10),
        failures: failures.slice(0, 20),
      },
      unknowns,
    }
  } catch (error) {
    if (error instanceof Cut) return { kind: "har", unknowns: [unknown("format", error.message)] }
    throw error
  }
}

const VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const VLQ_MAP = new Map(Array.from(VLQ_CHARS, (c, i) => [c, i] as const))

const countSegments = (mappings: string): { lines: number; segments: number } => {
  let lines = 0
  let segments = 0
  let valid = true
  for (const line of mappings.split(";")) {
    lines += 1
    if (line === "") continue
    for (const seg of line.split(",")) {
      let cont = true
      for (const ch of seg) {
        const v = VLQ_MAP.get(ch)
        if (v === undefined) {
          valid = false
          break
        }
        cont = (v & 32) !== 0
      }
      if (!valid) break
      if (!cont) segments += 1
    }
    if (!valid || segments > 50_000_000) break
  }
  if (!valid) throw new Cut("Source-map mappings contain non-VLQ characters.")
  return { lines, segments }
}

export const analyzeSourceMap = (text: string): WebAnalysis => {
  const unknowns: Unknown[] = []
  try {
    const root = obj(parseJson(text, "source map"))
    if (!root) throw new Cut("Source map root is not an object.")
    const sources = Array.isArray(root["sources"]) ? root["sources"] : []
    const contents = Array.isArray(root["sourcesContent"]) ? root["sourcesContent"] : []
    const names = Array.isArray(root["names"]) ? root["names"] : []
    const mappings = str(root["mappings"]) ?? ""
    if (!mappings) unknowns.push(unknown("omission", "Source map has empty mappings; names/sources only."))
    const counted = mappings ? countSegments(mappings) : { lines: 0, segments: 0 }
    if (sources.length === 0) unknowns.push(unknown("omission", "Source map lists no sources."))
    return {
      kind: "sourcemap",
      sourcemap: {
        sources: sources.length,
        sourcesWithContent: contents.filter((c) => typeof c === "string").length,
        names: names.length,
        mappingsBytes: mappings.length,
        generatedLines: counted.lines,
        ...(str(root["file"]) ? { file: str(root["file"]) } : {}),
      },
      unknowns,
    }
  } catch (error) {
    if (error instanceof Cut) return { kind: "sourcemap", unknowns: [unknown("format", error.message)] }
    throw error
  }
}

export * as ReverseWeb from "./web"
