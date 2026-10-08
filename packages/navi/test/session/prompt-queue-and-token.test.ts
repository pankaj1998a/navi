import { describe, expect, it } from "bun:test"
import {
  canMergeFront,
  canMergeFollower,
  combinePrefixLen,
  joinTexts,
  formatFollowupReminders,
  type CombineGate,
} from "../../src/session/prompt-queue"
import {
  estimate,
  estimateTokens,
  estimateChars,
  estimateImageTokens,
  usagePercentage,
  freeTokens,
  exceedsThreshold,
  exceedsThresholdWithHeadroom,
  IMAGE_TOKEN_ESTIMATE,
} from "../../src/util/token"
import type { MessageV2 } from "../../src/session/message-v2"
import { MessageID } from "../../src/session/schema"

describe("Grok Build ported features", () => {
  describe("xai-token-estimation", () => {
    it("estimates tokens correctly from string length", () => {
      expect(estimate("")).toBe(0)
      expect(estimate("abcd")).toBe(1)
      expect(estimateTokens("abcdefgh")).toBe(2)
      expect(estimateChars(100)).toBe(400)
    })

    it("estimates image tokens accurately", () => {
      expect(estimateImageTokens(1)).toBe(IMAGE_TOKEN_ESTIMATE)
      expect(estimateImageTokens(3)).toBe(IMAGE_TOKEN_ESTIMATE * 3)
    })

    it("calculates usage percentage and free tokens", () => {
      expect(usagePercentage(50, 100)).toBe(50)
      expect(usagePercentage(120, 100)).toBe(100)
      expect(usagePercentage(0, 0)).toBe(0)

      expect(freeTokens(1000, 250)).toBe(750)
      expect(freeTokens(1000, 1200)).toBe(0)
    })

    it("evaluates threshold and headroom checks", () => {
      // 80% threshold of 100_000 is 80_000
      expect(exceedsThreshold(79_999, 100_000, 80)).toBe(false)
      expect(exceedsThreshold(80_000, 100_000, 80)).toBe(true)

      // With 5_000 headroom, threshold drops to 75_000
      expect(exceedsThresholdWithHeadroom(74_000, 100_000, 80, 5_000)).toBe(false)
      expect(exceedsThresholdWithHeadroom(75_000, 100_000, 80, 5_000)).toBe(true)
    })
  })

  describe("xai-prompt-queue", () => {
    it("canMergeFront and canMergeFollower validate gate eligibility", () => {
      const front: CombineGate = {
        id: "msg_1",
        isPlainPrompt: true,
        isSynthetic: false,
        isExpandedSkill: false,
        isBash: false,
        hasImages: false,
        text: "Please fix the navbar",
      }
      expect(canMergeFront(front)).toBe(true)
      expect(canMergeFollower(front)).toBe(true)

      const withImages: CombineGate = { ...front, id: "msg_2", hasImages: true }
      expect(canMergeFront(withImages)).toBe(true)
      expect(canMergeFollower(withImages)).toBe(false)

      const synthetic: CombineGate = { ...front, id: "msg_3", isSynthetic: true }
      expect(canMergeFront(synthetic)).toBe(false)
    })

    it("combinePrefixLen computes mergeable run length", () => {
      const g1: CombineGate = { id: "1", isPlainPrompt: true, isSynthetic: false, isExpandedSkill: false, isBash: false, hasImages: false, text: "one" }
      const g2: CombineGate = { id: "2", isPlainPrompt: true, isSynthetic: false, isExpandedSkill: false, isBash: false, hasImages: false, text: "two" }
      const g3: CombineGate = { id: "3", isPlainPrompt: true, isSynthetic: false, isExpandedSkill: false, isBash: false, hasImages: false, text: "three" }
      const g4: CombineGate = { id: "4", isPlainPrompt: true, isSynthetic: false, isExpandedSkill: false, isBash: false, hasImages: true, text: "four" }

      expect(combinePrefixLen([g1, g2, g3])).toBe(3)
      expect(combinePrefixLen([g1, g2, g4])).toBe(2)
      expect(combinePrefixLen([])).toBe(0)
    })

    it("joinTexts joins items with standard double-newline", () => {
      expect(joinTexts(["first instruction", "second instruction"])).toBe("first instruction\n\nsecond instruction")
    })

    it("formatFollowupReminders merges multiple followups into a consolidated reminder", () => {
      const m1: MessageV2.WithParts = {
        info: {
          id: MessageID.ascending(),
          role: "user",
          time: { created: Date.now() },
          sessionID: "s1" as any,
          agent: "build",
          model: { providerID: "test" as any, modelID: "test" as any },
        },
        parts: [{ id: "p1" as any, sessionID: "s1" as any, messageID: "m1" as any, type: "text", text: "Also update the CSS" }],
      }

      const m2: MessageV2.WithParts = {
        info: {
          id: MessageID.ascending(),
          role: "user",
          time: { created: Date.now() },
          sessionID: "s1" as any,
          agent: "build",
          model: { providerID: "test" as any, modelID: "test" as any },
        },
        parts: [{ id: "p2" as any, sessionID: "s1" as any, messageID: "m2" as any, type: "text", text: "Make sure tests pass" }],
      }

      const merged = formatFollowupReminders([m1, m2])
      expect(merged).toBeDefined()
      expect(merged).toContain("The user sent 2 follow-up messages:")
      expect(merged).toContain("Also update the CSS\n\nMake sure tests pass")
    })
  })
})
