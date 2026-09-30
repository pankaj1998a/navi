import { describe, expect, it } from "bun:test"
import {
  overlapsHistory,
  lineSpan,
  sameCommentSpan,
  buildPolicy,
  routeComment,
  buildBadge,
  buildBadgeImage,
  buildCheckpointMarker,
  parseCheckpointMarker,
  buildSummaryBody,
  buildRunTags,
  resolveThreshold,
  DEFAULT_OVERLAP_THRESHOLD,
  SUMMARY_MARKER,
} from "../../src/github/post-review-comments"

describe("post-review-comments", () => {
  describe("SUMMARY_MARKER", () => {
    it("should be defined as navi-summary", () => {
      expect(SUMMARY_MARKER).toBe("<!-- navi-summary -->")
    })
  })

  describe("buildRunTags", () => {
    it("should build tags with navi prefix", () => {
      const tags = buildRunTags(12345, 2)
      expect(tags.RUN_TAG).toBe("12345-2")
      expect(tags.REVIEW_TAG).toBe("<!-- navi-review-run:12345-2 -->")
      expect(tags.SUMMARY_TAG).toBe("<!-- navi-summary-run:12345-2 -->")
    })
  })

  describe("lineSpan and sameCommentSpan", () => {
    it("extracts single line span", () => {
      const span = lineSpan({ line: 42 })
      expect(span).toEqual({ start: 42, end: 42, multiline: false })
    })

    it("extracts multi line span", () => {
      const span = lineSpan({ start_line: 10, line: 20 })
      expect(span).toEqual({ start: 10, end: 20, multiline: true })
    })

    it("detects identical single line as same span", () => {
      const s1 = lineSpan({ line: 15 })
      const s2 = lineSpan({ line: 15 })
      expect(sameCommentSpan(s1, s2, 0.6)).toBe(true)
    })

    it("detects different single line as different span", () => {
      const s1 = lineSpan({ line: 15 })
      const s2 = lineSpan({ line: 16 })
      expect(sameCommentSpan(s1, s2, 0.6)).toBe(false)
    })

    it("detects overlapping multi line with high IoU", () => {
      // span 1: 10..20 (11 lines), span 2: 12..20 (9 lines)
      // intersection: 12..20 (9 lines)
      // union: 10..20 (11 lines)
      // IoU = 9/11 = 0.818 > 0.6
      const s1 = lineSpan({ start_line: 10, line: 20 })
      const s2 = lineSpan({ start_line: 12, line: 20 })
      expect(sameCommentSpan(s1, s2, 0.6)).toBe(true)
    })

    it("detects overlapping multi line with low IoU as not matching", () => {
      // span 1: 1..20 (20 lines), span 2: 18..30 (13 lines)
      // intersection: 18..20 (3 lines)
      // union: 1..30 (30 lines)
      // IoU = 3/30 = 0.1 < 0.6
      const s1 = lineSpan({ start_line: 1, line: 20 })
      const s2 = lineSpan({ start_line: 18, line: 30 })
      expect(sameCommentSpan(s1, s2, 0.6)).toBe(false)
    })
  })

  describe("overlapsHistory", () => {
    it("matches existing comments on same path and lines", () => {
      const current = { path: "src/main.ts", line: 25, side: "RIGHT" }
      const history = [
        { path: "src/main.ts", line: 25, side: "RIGHT" },
        { path: "src/other.ts", line: 10, side: "RIGHT" },
      ]
      expect(overlapsHistory(current, history, DEFAULT_OVERLAP_THRESHOLD)).toBe(true)
    })

    it("does not match if path differs", () => {
      const current = { path: "src/different.ts", line: 25, side: "RIGHT" }
      const history = [{ path: "src/main.ts", line: 25, side: "RIGHT" }]
      expect(overlapsHistory(current, history, DEFAULT_OVERLAP_THRESHOLD)).toBe(false)
    })
  })

  describe("buildPolicy and routeComment", () => {
    it("routes by severity below threshold", () => {
      const policy = buildPolicy({ severityThreshold: "low" })
      const lowComment = { severity: "low", category: "bug" }
      const highComment = { severity: "high", category: "bug" }

      const resLow = routeComment(lowComment, policy)
      expect(resLow.routed).toBe(true)

      const resHigh = routeComment(highComment, policy)
      expect(resHigh.routed).toBe(false)
    })

    it("routes by category", () => {
      const policy = buildPolicy({ categories: "style,documentation" })
      const styleComment = { severity: "high", category: "style" }
      const bugComment = { severity: "high", category: "bug" }

      const resStyle = routeComment(styleComment, policy)
      expect(resStyle.routed).toBe(true)

      const resBug = routeComment(bugComment, policy)
      expect(resBug.routed).toBe(false)
    })
  })

  describe("buildBadge and buildBadgeImage", () => {
    it("builds plain badge text", () => {
      expect(buildBadge({ category: "security", severity: "critical" })).toBe("[security · critical]")
      expect(buildBadge({ category: "style" })).toBe("[style]")
      expect(buildBadge({ severity: "medium" })).toBe("[medium]")
      expect(buildBadge({})).toBe("")
    })

    it("builds shields badge markdown", () => {
      const badge = buildBadgeImage({ category: "security", severity: "critical" })
      expect(badge).toContain("https://img.shields.io/badge/security-critical-darkred")
      expect(badge).toContain("![security · critical]")
    })
  })

  describe("checkpoints", () => {
    it("builds and parses navi checkpoint markers", () => {
      const payload = { head: "a".repeat(40), pr: 42, base_ref: "main" }
      const marker = buildCheckpointMarker(payload)
      expect(marker).toContain("<!-- navi-checkpoint:v1")
      const parsed = parseCheckpointMarker(marker)
      expect(parsed).toEqual(payload)
    })

    it("parses legacy ocr checkpoint markers", () => {
      const payload = { head: "b".repeat(40), pr: 99, base_ref: "dev" }
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64")
      const ocrMarker = `<!-- ocr-checkpoint:v1 ${encoded} -->`
      const parsed = parseCheckpointMarker(ocrMarker)
      expect(parsed).toEqual(payload)
    })
  })

  describe("buildSummaryBody", () => {
    it("renders formatted summary with Navi branding", () => {
      const summary = buildSummaryBody({
        total: 5,
        inline: 3,
        summary: 1,
        skipped: 1,
        routed: 0,
        failed: 0,
        warnings: [],
      })
      expect(summary).toContain("Navi Code Review")
      expect(summary).toContain("found **5** issue(s)")
      expect(summary).toContain("Successfully posted inline: 3")
      expect(summary).toContain("In summary (no line info): 1")
      expect(summary).toContain("Skipped (overlap with history): 1")
    })
  })
})
