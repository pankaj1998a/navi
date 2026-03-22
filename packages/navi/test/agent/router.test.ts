import { expect, test } from "bun:test"
import { AgentRouter } from "../../src/agent/router"

function model(id: string, providerID: string, options: Partial<any> = {}) {
  return {
    id,
    providerID,
    name: id,
    api: { id, url: `https://${providerID}.example/v1`, npm: "@ai-sdk/openai-compatible" },
    status: "active",
    options: {},
    headers: {},
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: false,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 8192 },
    variants: {},
    ...options,
  } as any
}

test("router falls back to a healthier capable model when requested model is a poor fit", () => {
  const requested = model("cheap-model", "provider-a")
  const better = model("strong-model", "provider-b", {
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
  })

  const decision = AgentRouter.chooseFromProviders({
    agentName: "build",
    requested,
    providers: [
      { id: "provider-a", source: "config", models: { "cheap-model": requested }, catalog: { source: "cache", fetchedAt: new Date(0).toISOString(), ageMs: 35 * 24 * 60 * 60 * 1000 } },
      { id: "provider-b", source: "api", models: { "strong-model": better }, catalog: { source: "cache", fetchedAt: new Date().toISOString(), ageMs: 1000 } },
    ] as any,
  })

  expect(decision.changed).toBe(true)
  expect(decision.model.id).toBe("strong-model")
})

test("router prefers a more reliable model when capability fit is similar", () => {
  const requested = model("fast-model", "provider-a", {
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
  })
  const reliable = model("reliable-model", "provider-b", {
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
  })

  const decision = AgentRouter.chooseFromProviders({
    agentName: "build",
    requested,
    providers: [
      { id: "provider-a", source: "api", models: { "fast-model": requested }, catalog: { source: "cache", fetchedAt: new Date().toISOString(), ageMs: 1000 } },
      { id: "provider-b", source: "api", models: { "reliable-model": reliable }, catalog: { source: "cache", fetchedAt: new Date().toISOString(), ageMs: 1000 } },
    ] as any,
    reliability: [
      { providerID: "provider-a", modelID: "fast-model", score: 10, successRate: 0.2, avgLatencyMs: 3000, samples: 10 },
      { providerID: "provider-b", modelID: "reliable-model", score: 92, successRate: 0.98, avgLatencyMs: 2500, samples: 40 },
    ],
  })

  expect(decision.changed).toBe(true)
  expect(decision.model.id).toBe("reliable-model")
})
