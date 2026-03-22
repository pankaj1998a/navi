import { expect, test } from "bun:test"
import { Awareness } from "../../src/agent/awareness"

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

test("profileForAgent maps vibe mode to strong reasoning/tooling constraints", () => {
  const vibemode = Awareness.profileForAgent("vibemode")
  expect(vibemode.cost).toBe("high")
  expect(vibemode.capabilities?.reasoning).toBe(true)
  expect(vibemode.capabilities?.toolcall).toBe(true)
})

test("profileForAgent maps investigator to codebase analysis constraints", () => {
  const investigator = Awareness.profileForAgent("investigator")
  expect(investigator.cost).toBe("low")
  expect(investigator.speed).toBe("fast")
  expect(investigator.capabilities?.reasoning).toBe(true)
  expect(investigator.capabilities?.toolcall).toBe(true)
})

test("recommendModelFromProviders prefers image-capable models for frontend", () => {
  const providers = [
    {
      id: "openai",
      models: {
        "text-only": model("text-only", "openai"),
        "image-capable": model("image-capable", "openai", {
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
        }),
      },
    },
  ]

  const recommendation = Awareness.recommendModelFromProviders(providers as any, Awareness.profileForAgent("frontend"))
  expect(recommendation?.id).toBe("image-capable")
})

test("buildVibemodeModelGuide summarizes active models for orchestration roles", () => {
  const providers = [
    {
      id: "openai",
      name: "OpenAI",
      models: {
        "lead-model": model("lead-model", "openai", {
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: false, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
        }),
      },
    },
  ]

  const guide = Awareness.buildVibemodeModelGuide(providers as any)
  expect(guide).toContain("Live model awareness")
  expect(guide).toContain("OpenAI (1 active)")
  expect(guide).toContain("Loop Lead")
  expect(guide).toContain("Gate Reviewer")
  expect(guide).toContain("openai/lead-model")
})
