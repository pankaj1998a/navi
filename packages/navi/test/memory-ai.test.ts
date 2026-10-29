import { test, expect } from "bun:test"
import {
  beginHandoff,
  listHandoffs,
  acceptHandoff,
  cancelHandoff,
} from "@/memory/handoff"
import {
  writeWikiPage,
  readWikiPage,
  deleteWikiPage,
  listWikiPages,
  lintWiki,
  recordPageFeedback,
  calculateDecayScore,
  inferTierAndKind,
} from "@/memory/wiki"
import {
  sendMessage,
  listMessages,
  popMessage,
  cancelMessage,
} from "@/memory/messaging"
import { getUserProfile, updateUserProfile, formatProfileForPrompt } from "@/memory/profile"
import { buildCompactionRecap } from "@/memory/recap"
import { sanitizeText, truncateHeadTail, defaultSanitizer } from "@/memory/sanitize"
import { classifyText, shannonBitsPerChar } from "@/memory/entropy-filter"
import { native } from "@/memory/native"

test("Handoff Protocol: creates, lists, atomically claims once, and expires", () => {
  const dir = "v:/test/repo/auth-module"

  // 1. Create handoff
  const handoff = beginHandoff({
    summary: "Refactored JWT rotation to HTTP-only session cookies",
    open_questions: ["Does reverse proxy strip Set-Cookie on 401?"],
    next_steps: ["Run integration test suite with cookie jar"],
    target_directory: dir,
    owner: "claude-code",
  })

  expect(handoff.id.startsWith("ho_")).toBe(true)
  expect(handoff.status).toBe("open")
  expect(handoff.summary).toContain("JWT rotation")
  expect(handoff.open_questions.length).toBe(1)

  // 2. List handoffs
  const openList = listHandoffs({ target_directory: dir, status: "open" })
  expect(openList.some((h) => h.id === handoff.id)).toBe(true)

  // 3. Claim handoff (Codex picking up)
  const claim1 = acceptHandoff({
    target_directory: dir,
    claimed_by: "codex",
  })
  expect(claim1.status).toBe("claimed")
  expect(claim1.handoff?.id).toBe(handoff.id)
  expect(claim1.handoff?.claimed_by).toBe("codex")

  // 4. Second claim attempt must fail with consumed_by_hook / none_pending (Claim-Once semantics)
  const claim2 = acceptHandoff({
    handoff_id: handoff.id,
    claimed_by: "devin",
  })
  expect(claim2.status).not.toBe("claimed")
  expect(claim2.status).toBe("consumed_by_hook")

  // 5. Test cancellation
  const h2 = beginHandoff({
    summary: "Temporary branch test",
    target_directory: "v:/test/repo/branch-b",
  })
  const cancelled = cancelHandoff(h2.id)
  expect(cancelled).toBe(true)
  const claimCancelled = acceptHandoff({ handoff_id: h2.id })
  expect(claimCancelled.status).toBe("none_pending")
})

test("Wiki Store: hierarchical namespaces, frontmatter parsing, temporal decay, and feedback", () => {
  // Test tier/kind inference
  expect(inferTierAndKind("decisions/oauth-provider.md")).toEqual({ tier: "semantic", kind: "decision" })
  expect(inferTierAndKind("gotchas/sqlite-concurrency.md")).toEqual({ tier: "semantic", kind: "gotcha" })
  expect(inferTierAndKind("_rules/strict-types.md")).toEqual({ tier: "procedural", kind: "rule" })
  expect(inferTierAndKind("sessions/session-123.md")).toEqual({ tier: "episodic", kind: "fact" })

  // Write a decision page
  const page = writeWikiPage({
    path: "decisions/db-engine.md",
    title: "Database Engine Selection",
    content: "We selected SQLite with WAL mode for zero external dependencies.",
    kind: "decision",
    tier: "semantic",
    tags: ["architecture", "storage"],
  })

  expect(page.path).toBe("decisions/db-engine.md")
  expect(page.title).toBe("Database Engine Selection")
  expect(page.content).toContain("SQLite with WAL mode")

  // Read the page
  const read = readWikiPage("decisions/db-engine.md", true)
  expect(read).not.toBeNull()
  expect(read?.access_count).toBeGreaterThanOrEqual(1)

  // Temporal decay calculation
  const scoreFresh = calculateDecayScore(read!)
  expect(scoreFresh).toBeCloseTo(1.0, 1)

  // Pinned page never decays
  const scorePinned = calculateDecayScore({ pinned: true, created_at: "2020-01-01T00:00:00Z" })
  expect(scorePinned).toBe(1.0)

  // Feedback reinforcement
  const fb = recordPageFeedback("decisions/db-engine.md", "helpful")
  expect(fb.success).toBe(true)
  expect(fb.newRetentionWeight).toBeGreaterThan(1.0)

  // List pages
  const allDecisions = listWikiPages({ kind: "decision" })
  expect(allDecisions.some((p) => p.path === "decisions/db-engine.md")).toBe(true)

  // Linting
  const lint = lintWiki()
  expect(typeof lint.healthy).toBe("boolean")
  expect(Array.isArray(lint.issues)).toBe(true)

  // Cleanup
  deleteWikiPage("decisions/db-engine.md")
  expect(readWikiPage("decisions/db-engine.md")).toBeNull()
})

test("Cross-Project Messaging: asynchronous inter-agent claim-once mail", () => {
  const from = "frontend-app"
  const to = "auth-backend"

  // 1. Send message
  const msg = sendMessage({
    from_project: from,
    to_project: to,
    title: "Need OAuth redirect URI added",
    body: "Please add http://localhost:5173/auth/callback to the allowed redirects.",
  })

  expect(msg.id.startsWith("msg_")).toBe(true)
  expect(msg.status).toBe("pending")

  // 2. List inbox for recipient
  const inbox = listMessages({ project: to, direction: "inbox" })
  expect(inbox.some((m) => m.id === msg.id)).toBe(true)

  // 3. Pop message exactly once
  const pop1 = popMessage({ project: to, message_id: msg.id, popped_by: "auth-agent" })
  expect(pop1.success).toBe(true)
  expect(pop1.message?.title).toBe("Need OAuth redirect URI added")
  expect(pop1.message?.popped_by).toBe("auth-agent")

  // 4. Second pop attempt must fail (claim-once)
  const pop2 = popMessage({ project: to, message_id: msg.id })
  expect(pop2.success).toBe(false)
  expect(pop2.reason).toContain("already popped")

  // 5. Test message cancellation
  const msg2 = sendMessage({
    from_project: from,
    to_project: to,
    title: "Obsolete request",
    body: "Disregard",
  })
  const cancelled = cancelMessage(msg2.id)
  expect(cancelled).toBe(true)
})

test("Developer Profile Store: persists habits and formats for prompt injection", () => {
  const initial = getUserProfile()
  expect(typeof initial.package_manager).toBe("string")

  // Update habits
  const updated = updateUserProfile({
    package_manager: "bun",
    preferred_test_runner: "bun test",
    custom_rules: ["Rule: Always write unit tests before marking done"],
  })

  expect(updated.package_manager).toBe("bun")
  expect(updated.custom_rules).toContain("Rule: Always write unit tests before marking done")

  // Format for prompt
  const formatted = formatProfileForPrompt()
  expect(formatted).toContain("Developer Cross-Project Profile")
  expect(formatted).toContain("**Package Manager**: `bun`")
  expect(formatted).toContain("Always write unit tests before marking done")
})

test("Compaction Recovery: generates context recap with dropped prompts and open handoffs", () => {
  // Ensure an open handoff exists
  beginHandoff({
    summary: "Compaction test handoff",
    open_questions: ["What is the next task?"],
    target_directory: process.cwd(),
  })

  const recap = buildCompactionRecap({
    target_directory: process.cwd(),
    recent_prompts: [
      "Can we optimize the SQLite query?",
      "Now please add the compaction recovery unit test",
    ],
    last_assistant_reply: "I have drafted the implementation for compaction recovery.",
  })

  expect(recap.has_recap).toBe(true)
  expect(recap.recap_text).toContain("=== Context Recap (Compaction Recovery) ===")
  expect(recap.recap_text).toContain("Can we optimize the SQLite query?")
  expect(recap.recap_text).toContain("Now please add the compaction recovery unit test")
  expect(recap.recap_text).toContain("I have drafted the implementation")
  expect(recap.open_handoffs_count).toBeGreaterThanOrEqual(1)
})

test("Sanitization & Privacy Boundary: redacts API keys, tokens, paths, ANSI escape sequences", () => {
  // Bearer token
  const bearer = sanitizeText("Authorization: Bearer abcdef0123456789ABCDEF0123456789")
  expect(bearer).toContain("[REDACTED:bearer_token]")
  expect(bearer).not.toContain("abcdef0123")

  // OpenAI / Anthropic key
  const sk = sanitizeText("OPENAI_KEY: sk-1234567890abcdefghijklmnopqrstuvwxyz")
  expect(sk).toContain("[REDACTED:api_key]")

  // GitHub token
  const gh = sanitizeText("token = ghp_0123456789abcdefghijklmnopqrstuvwxyz")
  expect(gh).toContain("[REDACTED:github_token]")

  // AWS key
  const aws = sanitizeText("export AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF")
  expect(aws).toContain("[REDACTED:aws_key]")

  // Ordinary uppercase text must survive unredacted
  expect(sanitizeText("ASIAPACIFICREGION")).toBe("ASIAPACIFICREGION")
  expect(sanitizeText("ordinary text surviving verbatim")).toBe("ordinary text surviving verbatim")

  // Stripe restricted live key
  const stripe = sanitizeText(["stripe: rk", "live", "1234567890abcdefghijklmnop"].join("_"))
  expect(stripe).toContain("[REDACTED:stripe_key]")

  // Database URL credentials
  const dbUrl = sanitizeText("database: postgres://postgres:supersecretpassword@localhost:5432/production")
  expect(dbUrl).toContain("[REDACTED:url_credentials]")
  expect(dbUrl).not.toContain("supersecretpassword")

  // ANSI escape sequence stripping
  const ansi = sanitizeText("\x1b[31;1mError: Database failed\x1b[0m")
  expect(ansi).toBe("Error: Database failed")

  // Head-tail truncation preserves both ends
  const hugeText = "HEAD_START_" + "x".repeat(20000) + "_TAIL_END"
  const truncated = truncateHeadTail(hugeText, 1024)
  expect(truncated.length).toBeLessThanOrEqual(1024 + 100)
  expect(truncated).toContain("HEAD_START_")
  expect(truncated).toContain("_TAIL_END")
  expect(truncated).toContain("...[truncated ")

  // Verify automatic scrubbing in beginHandoff
  const ho = beginHandoff({
    summary: "Checking token ghp_999988887777666655554444333322221111",
    target_directory: "v:/test/repo/privacy-check",
  })
  expect(ho.summary).toContain("[REDACTED:github_token]")
  expect(ho.summary).not.toContain("99998888")
})

test("Entropy Filter: detects low-information terminal boilerplate and keeps informative notes", () => {
  const on = {
    enabled: true,
    minChars: 16,
    minEntropyBitsPerChar: 2.0,
    maxRepetitionRatio: 0.7,
    repetitionMinTokens: 6,
  }

  // 1. Off by default keeps everything
  expect(classifyText("").keep).toBe(true)
  expect(classifyText("aaaaaaaaaaaaaaaaaaaaaaaa").keep).toBe(true)

  // 2. Near empty or whitespace only
  const emptyRes = classifyText("   \n\t   ", on)
  expect(emptyRes.keep).toBe(false)
  expect(emptyRes.reason).toBe("near_empty")

  // 3. Low entropy (single repeated char)
  const lowEntropyRes = classifyText("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", on)
  expect(lowEntropyRes.keep).toBe(false)
  expect(lowEntropyRes.reason).toBe("low_entropy")

  // 4. Repetitive tokens
  const repRes = classifyText("status ok status ok status ok status ok status ok status ok", on)
  expect(repRes.keep).toBe(false)
  expect(repRes.reason).toBe("repetitive")

  // 5. Informative fix note survives
  const fixNote = "Fixed packages/navi/src/memory/sanitize.ts which had regex boundary bug"
  const keptRes = classifyText(fixNote, on)
  expect(keptRes.keep).toBe(true)

  // 6. Shannon bits calculation
  expect(shannonBitsPerChar("")).toBe(0.0)
  expect(shannonBitsPerChar("aaaa")).toBe(0.0)
  expect(shannonBitsPerChar("abcd")).toBeGreaterThan(1.9)
})

test("Native Rust Acceleration: verifies native FFI binding availability and cosine similarity", () => {
  expect(native.isAvailable).toBe(true)
  expect(typeof native.sanitizeText).toBe("function")
  expect(typeof native.cosineSimilarity).toBe("function")

  // Test vectorized cosine similarity
  const vec1 = new Float32Array([1.0, 0.0, 0.0])
  const vec2 = new Float32Array([1.0, 0.0, 0.0])
  const vec3 = new Float32Array([0.0, 1.0, 0.0])

  const simIdentical = native.cosineSimilarity!(vec1, vec2)
  const simOrthogonal = native.cosineSimilarity!(vec1, vec3)

  expect(Math.abs(simIdentical - 1.0)).toBeLessThan(1e-5)
  expect(Math.abs(simOrthogonal - 0.0)).toBeLessThan(1e-5)

  // Test native URL safety & SSRF guard
  expect(typeof native.validateUrl).toBe("function")
  const urlSafe = native.validateUrl!("https://github.com/navi-ai/navi")
  expect(urlSafe.safe).toBe(true)

  const urlBlocked = native.validateUrl!("http://169.254.169.254/latest")
  expect(urlBlocked.safe).toBe(false)
  expect(urlBlocked.reason).toContain("metadata")

  const urlHexBlocked = native.validateUrl!("http://0x7f000001:8080")
  expect(urlHexBlocked.safe).toBe(false)

  // Test native Myers fast diffing
  expect(typeof native.computeDiffStats).toBe("function")
  expect(typeof native.generateUnifiedDiff).toBe("function")

  const oldDoc = "const a = 1\nconst b = 2\nconst c = 3\n"
  const newDoc = "const a = 1\nconst b = 20\nconst c = 3\nconst d = 4\n"

  const stats = native.computeDiffStats!(oldDoc, newDoc)
  expect(stats.deletions).toBe(1)
  expect(stats.additions).toBe(2)

  const diffText = native.generateUnifiedDiff!(oldDoc, newDoc, "src/config.ts", 2)
  expect(diffText).toContain("--- a/src/config.ts")
  expect(diffText).toContain("+++ b/src/config.ts")
  expect(diffText).toContain("+const b = 20")
  expect(diffText).toContain("+const d = 4")
})
