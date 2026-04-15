import { describe, expect, it } from "bun:test"
import { EXTRA_PROVIDER_ENTRIES, resolveProviderForAuth } from "./auth"

describe("auth provider mapping", () => {
    it("maps KiloCode-style aliases to Navi auth providers", () => {
        expect(resolveProviderForAuth("claude-code")).toBe("anthropic")
        expect(resolveProviderForAuth("qwen-code")).toBe("qwen-cli")
    })

    it("preserves provider IDs that are not aliases", () => {
        expect(resolveProviderForAuth("deepseek")).toBe("deepseek")
        expect(resolveProviderForAuth("gemini-cli")).toBe("gemini-cli")
    })

    it("includes expected extra provider entries for CLI ecosystems", () => {
        const ids = new Set(EXTRA_PROVIDER_ENTRIES.map((entry) => entry.id))

        for (const expected of [
            "google-antigravity",
            "gemini-cli",
            "qwen-cli",
            "claude-code",
            "qwen-code",
            "deepseek",
            "moonshot",
            "mistral",
            "xai",
            "groq",
            "fireworks",
            "sambanova",
            "zai",
            "minimax",
            "baseten",
            "inception",
            "ovhcloud",
        ]) {
            expect(ids.has(expected)).toBe(true)
        }
    })
})



