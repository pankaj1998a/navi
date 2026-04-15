import { describe, it, expect, vi } from "vitest";
import { AIAgent } from "../src/agent";
import { ContextCompressor } from "../src/context-compressor";

describe("AIAgent Core", () => {
  it("should initialize with system prompt", () => {
    const agent = new AIAgent({
      name: "test",
      model: { modelID: "test-model", providerID: "test-provider" },
      systemPrompt: "System Prompt",
    });
    
    const messages = agent.getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe("System Prompt");
  });

  it("should run a turn and update history", async () => {
    const agent = new AIAgent({
      name: "test",
      model: { modelID: "test-model", providerID: "test-provider" },
    });

    const completionFn = vi.fn().mockResolvedValue({
      content: "Assistant Response",
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    const response = await agent.run("User Message", completionFn);

    expect(response).toBe("Assistant Response");
    const messages = agent.getMessages();
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("should trigger compression when limit is reached", async () => {
    // Set a very low limit for testing
    const compressor = new ContextCompressor(50, 10);
    const agent = new AIAgent({
      name: "test",
      model: { modelID: "test-model", providerID: "test-provider" },
    }, compressor);

    const completionFn = vi.fn().mockResolvedValue({
      content: "Assistant Response that is quite long to hit limits",
      usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
    });

    // Run multiple turns
    await agent.run("M1", completionFn);
    await agent.run("M2", completionFn);
    await agent.run("M3", completionFn);
    await agent.run("M4", completionFn);
    await agent.run("M5", completionFn);
    await agent.run("M6", completionFn);

    const messages = agent.getMessages();
    // Verify that compression occurred (should have the truncation marker)
    expect(messages.some(m => m.content.includes("compressed"))).toBe(true);
  });
});
