import { describe, expect, test } from "bun:test"
import {
  shannonEntropy,
  SecretScrubber,
  isPathContained,
  SandboxPathGuard,
  DestructiveCommandGuard,
} from "../src/sandbox"
import { SessionPromptQueue, canMergeFront, canMergeFollower, combinePrefixLen } from "../src/session/prompt-queue"
import path from "path"

describe("Sandbox Guards & Security Hardening Tests", () => {
  test("1. Shannon entropy calculator accurately detects high randomness", () => {
    // Low entropy repetitive string
    expect(shannonEntropy("aaaaaaaaaaaaaaaaaaaaaaaa")).toBeLessThan(1.0)
    expect(shannonEntropy("abcabcabcabcabcabcabcabc")).toBeLessThan(2.0)

    // High entropy cryptographic keys
    const hexKey = "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"
    const b64Secret = "kX8+9mZ1T4qLw0yU2vO5xR7bN8mQ1pC="
    expect(shannonEntropy(hexKey)).toBeGreaterThan(3.5)
    expect(shannonEntropy(b64Secret)).toBeGreaterThan(3.7)
  })

  test("2. SecretScrubber redacts standard API tokens and high-entropy secrets", () => {
    const input = [
      ["OpenAI: sk", "abc1234567890123456789012345"].join("-"),
      ["Anthropic: sk", "ant", "api03", "abcdef1234567890", "abcdef12"].join("-"),
      ["Google: AIzaSy", "A1234567890abcdef1234567890abcdef"].join(""),
      ["GitHub: ghp", "1234567890abcdef1234567890abcdef123456"].join("_"),
      ["Stripe: sk", "live", "51AbcdEFG1234567890Hijklm"].join("_"),
      "High entropy secret: 9f82d1c4b7a3e5f20184c6d98e721a3b4c5d6e7f",
    ].join("\n")

    const scrubbed = SecretScrubber.scrub(input)
    expect(scrubbed).toContain("[REDACTED_OPENAI_API_KEY]")
    expect(scrubbed).toContain("[REDACTED_ANTHROPIC_API_KEY]")
    expect(scrubbed).toContain("[REDACTED_GOOGLE_API_KEY]")
    expect(scrubbed).toContain("[REDACTED_GITHUB_TOKEN]")
    expect(scrubbed).toContain("[REDACTED_STRIPE_API_KEY]")
    expect(scrubbed).toContain("[REDACTED_HIGH_ENTROPY_KEY]")
    expect(scrubbed).not.toContain("sk-abc")
    expect(scrubbed).not.toContain("9f82d1c4")
  })

  test("3. Path containment strictly denies prefix bleed (/tmp/foo vs /tmp/foo2)", () => {
    const root = path.resolve("/workspace/project")
    const insideSub = path.resolve("/workspace/project/src/index.ts")
    const exactRoot = path.resolve("/workspace/project")
    const prefixBleed = path.resolve("/workspace/project2/secret.txt")
    const outside = path.resolve("/workspace/other/file.txt")

    expect(isPathContained(root, insideSub)).toBe(true)
    expect(isPathContained(root, exactRoot)).toBe(true)
    // Sibling prefix bleed must be strictly FALSE
    expect(isPathContained(root, prefixBleed)).toBe(false)
    expect(isPathContained(root, outside)).toBe(false)
  })

  test("4. SandboxPathGuard blocks writes outside workspace root and sensitive paths", () => {
    const policy = { mode: "workspace-write" as const, workspaceRoot: path.resolve("/app/src") }

    // Inside workspace is allowed
    expect(() => {
      SandboxPathGuard.assertPathAllowed(path.resolve("/app/src/nested/file.ts"), policy, true)
    }).not.toThrow()

    // Sibling prefix bleed is denied
    expect(() => {
      SandboxPathGuard.assertPathAllowed(path.resolve("/app/src2/hack.ts"), policy, true)
    }).toThrow(/SANDBOX_VIOLATION/)

    // Sensitive credential paths are denied even for read
    expect(() => {
      SandboxPathGuard.assertPathAllowed(path.resolve("/home/user/.ssh/id_rsa"), policy, false)
    }).toThrow(/SANDBOX_VIOLATION/)

    expect(() => {
      SandboxPathGuard.assertPathAllowed(path.resolve("/home/user/.aws/credentials"), policy, false)
    }).toThrow(/SANDBOX_VIOLATION/)
  })

  test("5. DestructiveCommandGuard blocks catastrophic system commands", () => {
    const dangerous = [
      "rm -rf /",
      "rm -r -f /",
      "rm -rf /*",
      "rm --recursive --no-preserve-root /",
      "del /f /s /q C:\\",
      "rmdir /s /q C:\\",
      "format C:",
      "diskpart",
      "mkfs.ext4 /dev/sda1",
      "dd if=/dev/zero of=/dev/sda",
      ":(){ :|:& };:",
      "chmod -R 777 /",
    ]

    for (const cmd of dangerous) {
      expect(() => DestructiveCommandGuard.assertCommandSafe(cmd)).toThrow(/SANDBOX_VIOLATION/)
    }

    // Safe commands are allowed
    expect(() => DestructiveCommandGuard.assertCommandSafe("npm run build")).not.toThrow()
    expect(() => DestructiveCommandGuard.assertCommandSafe("git status")).not.toThrow()
    expect(() => DestructiveCommandGuard.assertCommandSafe("rm -f ./dist/temp.txt")).not.toThrow()
  })

  test("6. SessionPromptQueue generates ULID identifiers and enforces FIFO drain", () => {
    const queue = new SessionPromptQueue()
    const item1 = queue.enqueue("sess_1", "First prompt")
    const item2 = queue.enqueue("sess_1", "Second prompt")

    expect(item1.id.startsWith("pq_")).toBe(true)
    expect(item2.id.startsWith("pq_")).toBe(true)
    expect(item1.id).not.toBe(item2.id)

    expect(queue.hasQueued("sess_1")).toBe(true)
    expect(queue.peek("sess_1")?.text).toBe("First prompt")

    const merged = queue.drainMerged("sess_1")
    expect(merged).toBe("First prompt\n\nSecond prompt")
    expect(queue.hasQueued("sess_1")).toBe(false)
  })

  test("7. Prompt queue pure combiners conform to Grok Build gate specs", () => {
    const frontGate = {
      id: "1",
      isPlainPrompt: true,
      isSynthetic: false,
      isExpandedSkill: false,
      isBash: false,
      hasImages: false,
      text: "hello",
    }
    const followerGate = { ...frontGate, id: "2", text: "world" }
    const bashGate = { ...frontGate, id: "3", isBash: true, text: "ls" }

    expect(canMergeFront(frontGate)).toBe(true)
    expect(canMergeFollower(followerGate)).toBe(true)
    expect(canMergeFollower(bashGate)).toBe(false)

    expect(combinePrefixLen([frontGate, followerGate])).toBe(2)
    expect(combinePrefixLen([frontGate, bashGate])).toBe(1)
  })
})
