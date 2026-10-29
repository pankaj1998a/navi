import type { ProviderLoader } from "../loader"
import * as Log from "@navi-ai/core/util/log"
import { ModelID, ProviderID } from "../schema"
import { InstallationVersion } from "@navi-ai/core/installation/version"
import { Flag } from "@navi-ai/core/flag/flag"
import { detectOpenCodeLocalAuth, checkOpenCodeServer, ensureOpenCodeServer } from "../../plugin/opencode"

const log = Log.create({ service: "opencode-provider" })

const DEFAULT_SERVER_URL = "http://127.0.0.1:4096"
const OPENCODE_BASE_URL = "https://opencode.ai/zen/v1"

const DEFAULT_OPENCODE_MODELS = [
  // Free tier models
  { id: "mimo-v2.6-flash-free", name: "MiMo-V2.6-Flash Free (OpenCode)", context: 200000, reasoning: true, vision: true },
  { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free (OpenCode)", context: 200000, reasoning: true, vision: false },
  { id: "step-5-preview-free", name: "Step 5 Preview Free (OpenCode)", context: 200000, reasoning: false, vision: false },
  { id: "ling-3.1-flash-free", name: "Ling 3.1 Flash Free (OpenCode)", context: 262144, reasoning: true, vision: false },
  { id: "space-bunny-free", name: "Space Bunny Free (OpenCode)", context: 128000, reasoning: false, vision: false },
  { id: "longcat-2.5-preview-free", name: "Longcat 2.5 Preview Free (OpenCode)", context: 128000, reasoning: false, vision: false },
  { id: "muse-spark-1.3-contributor-free", name: "Muse Spark 1.3 Free (OpenCode)", context: 128000, reasoning: false, vision: false },
  { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free (OpenCode)", context: 262144, reasoning: true, vision: false },
  // Flagship & subscription models
  { id: "claude-fable-5-1", name: "Claude Fable 5.1 (OpenCode)", context: 1000000, reasoning: true, vision: true },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5 (OpenCode)", context: 1000000, reasoning: true, vision: true },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5 (OpenCode)", context: 1000000, reasoning: true, vision: true },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5 (OpenCode)", context: 1000000, reasoning: true, vision: true },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol (OpenCode)", context: 272000, reasoning: true, vision: true },
  { id: "gpt-6-astra", name: "GPT-6 Astra (OpenCode)", context: 272000, reasoning: true, vision: true },
  { id: "gpt-6-luna", name: "GPT-6 Luna (OpenCode)", context: 272000, reasoning: true, vision: true },
  { id: "gpt-6-sol", name: "GPT-6 Sol (OpenCode)", context: 272000, reasoning: true, vision: true },
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (OpenCode)", context: 1048576, reasoning: true, vision: true },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash (OpenCode)", context: 1048576, reasoning: true, vision: true },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash (OpenCode)", context: 128000, reasoning: true, vision: false },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (OpenCode)", context: 128000, reasoning: true, vision: false },
  { id: "big-pickle", name: "Big Pickle (OpenCode)", context: 200000, reasoning: true, vision: false },
]

function createOpenCodeBridgeFetch(_fallbackURL: string, apiKey?: string) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url

    if (urlStr.includes("/chat/completions")) {
      const isLocalTarget = /\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(urlStr)
      const isBridgeTarget = isLocalTarget && (!apiKey || apiKey === "public")
      const isServerUp = isBridgeTarget ? await ensureOpenCodeServer() : false
      if (isServerUp) {
        try {
          const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body
          const rawModel = body?.model || "mimo-v2.6-flash-free"
          const modelID = String(rawModel).replace(/^(opencode|opencode-cli)\//, "")

          const messages: any[] = Array.isArray(body?.messages) ? body.messages : []
          const systemParts = messages
            .filter((m) => m.role === "system")
            .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
            .join("\n\n")

          const nonSystem = messages.filter((m) => m.role !== "system")
          let promptText = ""
          if (nonSystem.length === 1) {
            const m = nonSystem[0]
            promptText = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
          } else if (nonSystem.length > 1) {
            promptText = nonSystem
              .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
              .join("\n\n")
          }

          const sRes = await fetch("http://127.0.0.1:4096/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ directory: process.cwd() }),
            signal: AbortSignal.timeout(10000),
          })
          if (!sRes.ok) throw new Error(`OpenCode session create failed: ${sRes.status}`)
          const session = await sRes.json()

          const mRes = await fetch(`http://127.0.0.1:4096/session/${session.id}/message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: { providerID: "opencode", modelID },
              system: systemParts || undefined,
              parts: [{ type: "text", text: promptText || "Hello" }],
            }),
            signal: AbortSignal.timeout(180000),
          })
          if (!mRes.ok) {
            const errText = await mRes.text()
            throw new Error(`OpenCode message failed (${mRes.status}): ${errText}`)
          }

          const data = await mRes.json()
          const text = data.parts?.filter((p: any) => p.type === "text").map((p: any) => p.text).join("") || ""
          const reasoning = data.parts?.filter((p: any) => p.type === "reasoning").map((p: any) => p.text).join("") || ""

          if (body?.stream) {
            const stream = new ReadableStream({
              start(controller) {
                const enc = new TextEncoder()
                if (reasoning) {
                  const reasoningChunk = JSON.stringify({
                    id: "chatcmpl-" + Date.now(),
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: modelID,
                    choices: [{ index: 0, delta: { reasoning_content: reasoning }, finish_reason: null }],
                  })
                  controller.enqueue(enc.encode(`data: ${reasoningChunk}\n\n`))
                }
                const contentChunk = JSON.stringify({
                  id: "chatcmpl-" + Date.now(),
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: modelID,
                  choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
                })
                controller.enqueue(enc.encode(`data: ${contentChunk}\n\n`))

                const finishChunk = JSON.stringify({
                  id: "chatcmpl-" + Date.now(),
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: modelID,
                  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                })
                controller.enqueue(enc.encode(`data: ${finishChunk}\n\n`))
                controller.enqueue(enc.encode(`data: [DONE]\n\n`))
                controller.close()
              },
            })
            return new Response(stream, {
              status: 200,
              headers: { "Content-Type": "text/event-stream; charset=utf-8" },
            })
          }

          return new Response(
            JSON.stringify({
              id: "chatcmpl-" + Date.now(),
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: modelID,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: text,
                    ...(reasoning ? { reasoning_content: reasoning } : {}),
                  },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: data.info?.tokens?.input || 0,
                completion_tokens: data.info?.tokens?.output || 0,
                total_tokens: data.info?.tokens?.total || 0,
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            },
          )
        } catch (e: any) {
          log.warn("Local OpenCode bridge error, falling back to direct upstream", { error: e.message })
        }
      }
    }

    return fetch(input, init)
  }
}

export const OpenCodeProvider: ProviderLoader.Info = {
  async load(input, dep) {
    const inputId = input?.id ?? "opencode"
    const inputEnv = input?.env ?? ["OPENCODE_API_KEY"]
    const inputModels = input?.models ?? {}

    const auth = (await dep.auth(inputId)) || (await dep.auth("opencode-cli"))
    const env = dep.env
    const config = dep.config

    let apiKey = (() => {
      const envKey = inputEnv.map((item) => env[item]).find(Boolean)
      if (envKey) return envKey

      if (auth) {
        if (auth.type === "api") return auth.key
        if (auth.type === "oauth") return auth.access
      }

      if (config.provider?.[inputId]?.options?.apiKey) {
        return config.provider[inputId].options.apiKey
      }

      return undefined
    })()

    let baseURL = (auth?.type === "api" ? auth.metadata?.url : undefined) || config.provider?.[inputId]?.options?.baseURL || OPENCODE_BASE_URL

    const isLocalServerRunning = await checkOpenCodeServer(DEFAULT_SERVER_URL)
    if (!apiKey && isLocalServerRunning) {
      baseURL = `${DEFAULT_SERVER_URL}/v1`
      log.info("Found active local OpenCode server runtime")
    }

    const hasKey = !!apiKey
    let models: Record<string, any> = { ...inputModels }

    for (const m of DEFAULT_OPENCODE_MODELS) {
      const modelID = ModelID.make(m.id)
      if (!models[modelID]) {
        models[modelID] = {
          id: modelID,
          providerID: ProviderID.make(inputId),
          name: m.name,
          api: {
            id: m.id,
            url: baseURL,
            npm: "@ai-sdk/openai-compatible",
          },
          status: "active",
          capabilities: {
            temperature: true,
            reasoning: m.reasoning,
            attachment: m.vision,
            toolcall: true,
            input: { text: true, audio: false, image: m.vision, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: m.reasoning ? { field: "reasoning_content" } : false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: m.context, output: 16384 },
          options: {},
          headers: {},
          release_date: new Date().toISOString(),
          variants: {},
        }
      }
    }

    // Dynamic model discovery from local OpenCode server or upstream models endpoint
    if (isLocalServerRunning) {
      try {
        const provRes = await fetch(`${DEFAULT_SERVER_URL}/provider`, { signal: AbortSignal.timeout(3000) })
        if (provRes.ok) {
          const provData = await provRes.json()
          const opencodeProv = provData?.all?.find((p: any) => p.id === "opencode")
          if (opencodeProv?.models) {
            for (const [id, m] of Object.entries((opencodeProv.models || {}) as Record<string, any>)) {
              const mid = ModelID.make(id)
              models[mid] = {
                id: mid,
                providerID: ProviderID.make(inputId),
                name: m.name || id,
                api: {
                  id,
                  url: baseURL,
                  npm: "@ai-sdk/openai-compatible",
                },
                status: "active",
                capabilities: {
                  temperature: true,
                  reasoning: id.includes("r1") || id.includes("free") || id.includes("flash") || id.includes("reasoning"),
                  attachment: true,
                  toolcall: true,
                  input: { text: true, audio: false, image: true, video: false, pdf: false },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: m.limit?.context || 128000, output: m.limit?.output || 16384 },
                options: {},
                headers: {},
                release_date: new Date().toISOString(),
                variants: {},
              }
            }
          }
        }
      } catch {
        // fallback to default models
      }
    } else if (hasKey) {
      try {
        const fetchHeaders: Record<string, string> = {
          "User-Agent": `opencode/${InstallationVersion}`,
          "x-opencode-client": Flag.NAVI_CLIENT || "cli",
          ...(apiKey && apiKey !== "public" ? { Authorization: `Bearer ${apiKey}` } : {}),
        }
        const res = await fetch(`${baseURL}/models`, {
          headers: fetchHeaders,
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok) {
          const data = await res.json()
          const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
          for (const item of list) {
            const id = item.id || item.name
            if (!id) continue
            const mid = ModelID.make(id)
            if (!models[mid]) {
              models[mid] = {
                id: mid,
                providerID: ProviderID.make(inputId),
                name: item.name || id,
                api: {
                  id,
                  url: baseURL,
                  npm: "@ai-sdk/openai-compatible",
                },
                status: "active",
                capabilities: {
                  temperature: true,
                  reasoning: id.includes("r1") || id.includes("free") || id.includes("reasoning"),
                  attachment: true,
                  toolcall: true,
                  input: { text: true, audio: false, image: true, video: false, pdf: false },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: item.context_length || 128000, output: 8192 },
                options: {},
                headers: {},
                release_date: new Date().toISOString(),
                variants: {},
              }
            }
          }
        }
      } catch {
        // fallback to default models
      }
    }

    const autoload = hasKey || isLocalServerRunning || !!apiKey

    return {
      autoload,
      options: {
        apiKey: apiKey || undefined,
        baseURL,
        fetch: createOpenCodeBridgeFetch(baseURL, apiKey),
        headers: {
          "User-Agent": `opencode/${InstallationVersion}`,
          "x-opencode-client": Flag.NAVI_CLIENT || "cli",
        },
      },
      models,
    }
  },
}

export const OpenCodeCliProvider = OpenCodeProvider
