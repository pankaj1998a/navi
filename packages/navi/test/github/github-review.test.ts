import { describe, expect, it } from "bun:test"
import {
  parseReviewFindings,
  isReviewRequest,
  computeConfigFingerprint,
} from "../../src/cli/cmd/github"

describe("github review helpers", () => {
  describe("isReviewRequest", () => {
    it("recognizes PR events as review requests", () => {
      expect(isReviewRequest("", "pull_request")).toBe(true)
      expect(isReviewRequest("", "pull_request_review_comment")).toBe(true)
    })

    it("recognizes review command prompts", () => {
      expect(isReviewRequest("/review")).toBe(true)
      expect(isReviewRequest("/ocr-review")).toBe(true)
      expect(isReviewRequest("/navi review this PR")).toBe(true)
      expect(isReviewRequest("please review this code")).toBe(true)
      expect(isReviewRequest("code review needed")).toBe(true)
      expect(isReviewRequest("fix this bug")).toBe(false)
    })
  })

  describe("computeConfigFingerprint", () => {
    it("computes deterministic 16-character hex hash", () => {
      const fp1 = computeConfigFingerprint("anthropic", "claude-3-5-sonnet-20241022", "high")
      const fp2 = computeConfigFingerprint("anthropic", "claude-3-5-sonnet-20241022", "high")
      const fp3 = computeConfigFingerprint("openai", "gpt-4o")

      expect(fp1).toBe(fp2)
      expect(fp1.length).toBe(16)
      expect(fp1).not.toBe(fp3)
    })
  })

  describe("parseReviewFindings", () => {
    it("parses findings from JSON code block", () => {
      const text = `
Here is my review:
\`\`\`json
[
  {
    "path": "src/index.ts",
    "start_line": 10,
    "end_line": 15,
    "severity": "high",
    "category": "security",
    "message": "Potential SQL injection vulnerability",
    "suggestion_code": "const query = db.prepare('SELECT * FROM users WHERE id = ?');"
  },
  {
    "path": "src/utils.ts",
    "line": 42,
    "severity": "medium",
    "category": "performance",
    "message": "Use a Map instead of Array.find for O(1) lookup"
  }
]
\`\`\`
Overall looks promising!
`
      const findings = parseReviewFindings(text)
      expect(findings.length).toBe(2)
      expect(findings[0]!.path).toBe("src/index.ts")
      expect(findings[0]!.start_line).toBe(10)
      expect(findings[0]!.end_line).toBe(15)
      expect(findings[0]!.severity).toBe("high")
      expect(findings[0]!.category).toBe("security")
      expect(findings[0]!.message).toBe("Potential SQL injection vulnerability")
      expect(findings[0]!.suggestion_code).toBe("const query = db.prepare('SELECT * FROM users WHERE id = ?');")

      expect(findings[1]!.path).toBe("src/utils.ts")
      expect(findings[1]!.start_line).toBe(42)
      expect(findings[1]!.end_line).toBe(42)
      expect(findings[1]!.severity).toBe("medium")
      expect(findings[1]!.category).toBe("performance")
    })

    it("parses findings from Markdown headings", () => {
      const text = `
### [high · security] File: src/auth.ts:25-30
Token is not validated before use.

### [low · style] File: src/config.ts:5
Prefer const over let.
`
      const findings = parseReviewFindings(text)
      expect(findings.length).toBe(2)
      expect(findings[0]!.path).toBe("src/auth.ts")
      expect(findings[0]!.start_line).toBe(25)
      expect(findings[0]!.end_line).toBe(30)
      expect(findings[0]!.severity).toBe("high")
      expect(findings[0]!.category).toBe("security")

      expect(findings[1]!.path).toBe("src/config.ts")
      expect(findings[1]!.start_line).toBe(5)
      expect(findings[1]!.end_line).toBe(5)
      expect(findings[1]!.severity).toBe("low")
      expect(findings[1]!.category).toBe("style")
    })

    it("returns empty array for text without review findings", () => {
      const text = "All looks good to me! No comments."
      const findings = parseReviewFindings(text)
      expect(findings).toEqual([])
    })
  })
})
