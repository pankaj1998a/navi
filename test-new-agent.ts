import { AIAgent, ContextCompressor, MemoryManager, ModelRouter } from "./packages/agent/src";

/**
 * Standalone test script to verify the new agent architecture.
 */
async function main() {
  console.log("--- Navi New Agent System Test ---\n");

  // 1. Test Model Routing
  console.log("[1] Testing Model Routing...");
  const routeConfig = {
    enabled: true,
    cheapModel: { modelID: "gpt-4o-mini", providerID: "openai" },
    strongModel: { modelID: "claude-3-5-sonnet", providerID: "anthropic" },
    maxSimpleChars: 50,
    maxSimpleWords: 10,
  };

  const complexQuery = "How do I refactor this complex architecture to support parallel processing?";
  const simpleQuery = "Hello, how are you?";

  const route1 = ModelRouter.chooseRoute(complexQuery, routeConfig);
  console.log(`Complex Query -> Route: ${route1.model.modelID} (${route1.reason})`);

  const route2 = ModelRouter.chooseRoute(simpleQuery, routeConfig);
  console.log(`Simple Query  -> Route: ${route2.model.modelID} (${route2.reason})\n`);

  // 2. Test AIAgent & Context Management
  console.log("[2] Testing AIAgent & Context Manager...");
  const agent = new AIAgent({
    name: "navi-v2",
    model: { modelID: "claude-3-5-sonnet", providerID: "anthropic" },
    systemPrompt: "You are an advanced Navi AI agent.",
  });

  const mockCompletion = async (options: any) => {
    return {
      content: `I am responding to: "${options.messages[options.messages.length - 1].content}"`,
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    };
  };

  await agent.run("First message", mockCompletion);
  await agent.run("Second message", mockCompletion);

  console.log(`Messages in history: ${agent.getMessages().length}`);
  agent.getMessages().forEach((m, i) => {
    console.log(`  [${i}] ${m.role}: ${m.content.substring(0, 50)}...`);
  });

  // 3. Test Skills Parsing
  console.log("\n[3] Testing Skills Parser...");
  const sampleSkill = `---
name: shell-pro
description: Advanced shell interaction skill
platform: [linux, darwin]
requires_tools: [terminal]
---
# Shell Professional
This skill allows the agent to use advanced bash patterns.
`;
  const { parseSkill } = await import("./packages/agent/src/skills/parser");
  const parsed = parseSkill(sampleSkill);
  console.log(`Parsed Skill: ${parsed.metadata.name} - ${parsed.metadata.description}`);
  console.log(`Compatible platforms: ${parsed.metadata.platform?.join(", ")}`);

  console.log("\n--- Test Completed Successfully ---");
}

main().catch(console.error);
