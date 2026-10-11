import type { ProviderLoader } from "../loader"
import * as Log from "@navi-ai/core/util/log"
import { ModelID, ProviderID } from "../schema"
import { spawn } from "child_process"
import { findAgyExecutable, detectAntigravityCredentials } from "../../plugin/antigravity"

const log = Log.create({ service: "antigravity-provider" })

const DEFAULT_ANTIGRAVITY_BASE_URL = "https://antigravity.local/v1"

export const ANTIGRAVITY_MODELS = [
  { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)", context: 1048576, reasoning: true, vision: true },
  { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)", context: 1048576, reasoning: true, vision: true },
  { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)", context: 1048576, reasoning: false, vision: true },
  { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", context: 1048576, reasoning: true, vision: true },
  { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", context: 1048576, reasoning: true, vision: true },
  { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", context: 1048576, reasoning: false, vision: true },
  { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)", context: 1048576, reasoning: true, vision: true },
  { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)", context: 1048576, reasoning: false, vision: true },
  { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)", context: 1048576, reasoning: true, vision: true },
  { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", context: 1048576, reasoning: false, vision: true },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", context: 1000000, reasoning: true, vision: true },
  { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)", context: 1000000, reasoning: true, vision: true },
  { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", context: 128000, reasoning: true, vision: false },
]

function formatMessagesToPrompt(messages: any[]): string {
  if (!Array.isArray(messages) || messages.length === 0) return "Hello"

  const systemParts = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n\n")

  const nonSystem = messages.filter((m) => m.role !== "system")
  if (nonSystem.length === 0) return systemParts || "Hello"

  if (nonSystem.length === 1 && !systemParts) {
    const m = nonSystem[0]
    return typeof m.content === "string" ? m.content : JSON.stringify(m.content)
  }

  const turns: string[] = []
  if (systemParts) {
    turns.push(`[System Instructions]\n${systemParts}\n`)
  }

  for (const m of nonSystem) {
    const role = m.role === "assistant" ? "Assistant" : "User"
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    turns.push(`${role}: ${content}`)
  }

  return turns.join("\n\n")
}

function createAntigravityBridgeFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url

    if (urlStr.includes("/chat/completions")) {
      const agyBin = findAgyExecutable()
      if (!agyBin) {
        throw new Error(
          "Antigravity CLI (agy) executable not found. Please install Google Antigravity CLI or add it to PATH.",
        )
      }

      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body
      const rawModel = body?.model || "gemini-3.8-flash-high"
      const modelID = String(rawModel).replace(/^(antigravity|google-antigravity|gemini-cli)\//, "")

      const promptText = formatMessagesToPrompt(body?.messages || [])
      const isStream = Boolean(body?.stream)

      const args = [
        "--model",
        modelID,
        "--input-format",
        "text",
        "--disable-slash-commands",
        "--output-format",
        "stream-json",
      ]

      if (isStream) {
        const stream = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder()
            const proc = spawn(agyBin, args, {
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
            })

            proc.stdin.on("error", () => {
              // ignore EPIPE if agy closes stdin
            })
            proc.stdin.write(promptText)
            proc.stdin.end()

            let buffer = ""
            let finished = false

            const finishOnce = () => {
              if (finished) return
              finished = true
              const stopChunk = JSON.stringify({
                id: "chatcmpl-" + Date.now(),
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: modelID,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              })
              controller.enqueue(enc.encode(`data: ${stopChunk}\n\n`))
              controller.enqueue(enc.encode(`data: [DONE]\n\n`))
              controller.close()
            }

            proc.stdout.on("data", (chunk) => {
              buffer += chunk.toString()
              const lines = buffer.split("\n")
              buffer = lines.pop() || ""

              for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed) continue
                try {
                  const event = JSON.parse(trimmed)
                  if (event.event === "step_update" && event.step_update?.text_delta) {
                    const chunkPayload = JSON.stringify({
                      id: "chatcmpl-" + Date.now(),
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: modelID,
                      choices: [{ index: 0, delta: { content: event.step_update.text_delta }, finish_reason: null }],
                    })
                    controller.enqueue(enc.encode(`data: ${chunkPayload}\n\n`))
                  } else if (event.event === "result") {
                    finishOnce()
                  }
                } catch {
                  // ignore non-json lines
                }
              }
            })

            proc.stderr.on("data", (err) => {
              log.warn("Antigravity agy stderr", { msg: err.toString() })
            })

            proc.on("close", () => {
              finishOnce()
            })

            proc.on("error", (err) => {
              log.error("Antigravity process error", { error: String(err) })
              finishOnce()
            })
          },
        })

        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        })
      }

      // Non-streaming mode
      return new Promise((resolve, reject) => {
        const proc = spawn(agyBin, args, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        })

        proc.stdin.on("error", () => {})
        proc.stdin.write(promptText)
        proc.stdin.end()

        let buffer = ""
        let resultText = ""
        let inputTokens = 0
        let outputTokens = 0

        proc.stdout.on("data", (chunk) => {
          buffer += chunk.toString()
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const event = JSON.parse(trimmed)
              if (event.event === "step_update" && event.step_update?.text_delta) {
                resultText += event.step_update.text_delta
              }
              if (event.event === "result" && event.result) {
                if (event.result.response) {
                  resultText = event.result.response
                }
                if (event.result.usage) {
                  inputTokens = event.result.usage.input_tokens || 0
                  outputTokens = event.result.usage.output_tokens || 0
                }
              }
            } catch {
              // ignore
            }
          }
        })

        proc.on("close", (code) => {
          if (code !== 0 && !resultText) {
            return reject(new Error(`Antigravity process exited with code ${code}`))
          }

          resolve(
            new Response(
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
                      content: resultText,
                    },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: inputTokens,
                  completion_tokens: outputTokens,
                  total_tokens: inputTokens + outputTokens,
                },
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json; charset=utf-8" },
              },
            ),
          )
        })

        proc.on("error", (err) => {
          reject(err)
        })
      })
    }

    if (urlStr.includes("/models")) {
      const data = ANTIGRAVITY_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        context_length: m.context,
      }))
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify({}), { status: 200 })
  }
}

export const AntigravityProvider: ProviderLoader.Info = {
  async load(input, dep) {
    const inputId = input?.id ?? "antigravity"
    const inputModels = input?.models ?? {}

    const auth =
      (await dep.auth(inputId)) ||
      (await dep.auth("google-antigravity")) ||
      (await dep.auth("antigravity")) ||
      (await dep.auth("gemini-cli"))

    const detected = await detectAntigravityCredentials()
    const hasAgyCli = !!findAgyExecutable()
    const hasAuth = !!auth || !!detected

    const models: Record<string, any> = { ...inputModels }

    for (const m of ANTIGRAVITY_MODELS) {
      const modelID = ModelID.make(m.id)
      if (!models[modelID]) {
        models[modelID] = {
          id: modelID,
          providerID: ProviderID.make(inputId),
          name: m.name,
          api: {
            id: m.id,
            url: DEFAULT_ANTIGRAVITY_BASE_URL,
            npm: "@ai-sdk/openai-compatible",
          },
          status: "active",
          capabilities: {
            temperature: true,
            reasoning: m.reasoning,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: m.vision, video: m.vision, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: m.context, output: 65535 },
          options: {},
          headers: {},
          release_date: new Date().toISOString(),
          variants: {},
        }
      }
    }

    return {
      autoload: hasAuth || hasAgyCli,
      options: {
        apiKey: "antigravity-local-session",
        baseURL: DEFAULT_ANTIGRAVITY_BASE_URL,
        fetch: createAntigravityBridgeFetch(),
      },
      models,
    }
  },
}

export const GoogleAntigravityProvider = AntigravityProvider
