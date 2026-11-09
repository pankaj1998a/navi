import { describe, expect, test } from "bun:test"
import { countTokensNative, compactMessagesNative } from "../../src/native/native-runner"
import { countTokens, estimate } from "../../src/util/token"

describe("Phase 3: Native Rust Exact BPE Tokenizer & Context Pruner (Headroom CCR)", () => {
  describe("Exact BPE Token Counting (cl100k_base)", () => {
    test("counts exact tokens for canonical cl100k benchmark phrases", () => {
      // Official cl100k_base tokenization:
      // "Hello, world!" -> ["Hello", ",", " world", "!"] = 4 tokens
      const helloTokens = countTokensNative("Hello, world!")
      expect(helloTokens).toBe(4)

      // "antidisestablishmentarianism" -> ["ant", "id", "is", "establishment", "arian", "ism"] = 6 tokens
      const wordTokens = countTokensNative("antidisestablishmentarianism")
      expect(wordTokens).toBe(6)
    })

    test("accurately tokenizes programming syntax and symbols", () => {
      const code = `
        import { Effect } from "effect"
        export const program = Effect.sync(() => {
          console.log("Hello Effect!")
        })
      `
      const tokens = countTokensNative(code)
      expect(tokens).not.toBeNull()
      expect(tokens!).toBeGreaterThan(20)
      expect(tokens!).toBeLessThan(45)

      // Delegating utility function should return identical count
      expect(countTokens(code)).toBe(tokens!)
    })

    test("handles heavy unicode, math equations, and emojis without crashing", () => {
      const complexText = "Euler's formula: e^{i\\pi} + 1 = 0. Rocket launch: 🚀🌌✨ — Advanced Agentic Coding."
      const tokens = countTokensNative(complexText)
      expect(tokens).not.toBeNull()
      expect(tokens!).toBeGreaterThan(15)
      expect(tokens!).toBeLessThan(40)
    })

    test("tokenizes 100KB payload in milliseconds", () => {
      const payload = "const x = 42; // Variable declaration\n".repeat(2500) // ~95KB
      const start = performance.now()
      const tokens = countTokensNative(payload)
      const elapsed = performance.now() - start

      expect(tokens).not.toBeNull()
      expect(tokens!).toBeGreaterThan(15000)
      expect(elapsed).toBeLessThan(350) // Native sub-process BPE execution completes in <350ms
    })
  })

  describe("Lossless Context Pruning & Tool Deduplication (CCR)", () => {
    test("deduplicates identical large tool outputs in intermediate turns", () => {
      const filePayload = "export class DataProcessor { /* 1000 lines of data */ }\n".repeat(50)

      const req = {
        messages: [
          {
            role: "system",
            parts: [{ type: "text", text: "You are Navi, an autonomous software engineer." }],
          },
          {
            role: "user",
            parts: [{ type: "text", text: "Inspect data processor." }],
          },
          {
            role: "assistant",
            parts: [
              { type: "tool", tool: "read_file", status: "done" },
              { type: "text", text: filePayload },
            ],
          },
          {
            role: "user",
            parts: [{ type: "text", text: "Please read it again to check line 40." }],
          },
          {
            role: "assistant",
            parts: [
              { type: "tool", tool: "read_file", status: "done" },
              { type: "text", text: filePayload }, // Identical payload
            ],
          },
          {
            role: "user",
            parts: [{ type: "text", text: "What is the result?" }],
          },
        ],
        max_tokens: 150,
        preserve_recent: 1,
      }

      const res = compactMessagesNative(req)
      expect(res).not.toBeNull()
      expect(res!.pruned_turns).toBeGreaterThan(0)
      expect(res!.compacted_tokens).toBeLessThan(res!.original_tokens)

      // Turn 0 (system) and Turn 5 (latest user) are preserved
      const firstMsg = res!.messages[0]
      const lastMsg = res!.messages[res!.messages.length - 1]
      expect(firstMsg?.role).toBe("system")
      expect(firstMsg?.parts[0]?.text).toContain("autonomous software engineer")
      expect(lastMsg?.role).toBe("user")
      expect(lastMsg?.parts[0]?.text).toBe("What is the result?")
    })

    test("preserves conversation turns intact when already within token budget", () => {
      const req = {
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
          {
            role: "assistant",
            parts: [{ type: "text", text: "Hi! How can I help?" }],
          },
        ],
        max_tokens: 5000,
        preserve_recent: 2,
      }

      const res = compactMessagesNative(req)
      expect(res).not.toBeNull()
      expect(res!.pruned_turns).toBe(0)
      expect(res!.compacted_tokens).toBe(res!.original_tokens)
      expect(res!.messages.length).toBe(2)
    })
  })
})
