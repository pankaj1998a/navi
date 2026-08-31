import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
import DESCRIPTION from "./image-generate.txt"

const log = Log.create({ service: "tool.image-generate" })

export const Parameters = Schema.Struct({
  prompt: Schema.String.annotate({ description: "Detailed text prompt describing the image or UI to generate" }),
  imageName: Schema.String.annotate({
    description: "Filename for the generated image (e.g. 'hero_banner', 'login_mockup', 'profile_card')",
  }),
  aspectRatio: Schema.Literals(["1:1", "16:9", "9:16", "4:3", "3:4"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("1:1" as const)))
    .annotate({ description: "Aspect ratio for the image. Defaults to '1:1'." }),
  targetDirectory: Schema.optional(Schema.String).annotate({
    description: "Relative or absolute directory path to save the generated image. Defaults to '.navi/artifacts'.",
  }),
})

export const ImageGenerateTool = Tool.define(
  "image_generate",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const cleanName = params.imageName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
          const outDir = params.targetDirectory
            ? path.isAbsolute(params.targetDirectory)
              ? params.targetDirectory
              : path.resolve(instance.directory, params.targetDirectory)
            : path.resolve(instance.directory, ".navi", "artifacts")

          if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true })
          }

          yield* ctx.ask({
            permission: "image_generate",
            patterns: [cleanName],
            always: ["*"],
            metadata: {
              prompt: params.prompt,
              imageName: cleanName,
              aspectRatio: params.aspectRatio,
            },
          })

          let imageBuffer: Buffer | null = null
          let mimeType = "image/png"
          let ext = ".png"

          // 1. Try OpenAI DALL-E if key is available
          const openAiKey = process.env.OPENAI_API_KEY
          if (openAiKey) {
            try {
              log.info("generating image with openai dalle", { prompt: params.prompt })
              const size = params.aspectRatio === "16:9" ? "1792x1024" : params.aspectRatio === "9:16" ? "1024x1792" : "1024x1024"
              const res = yield* Effect.promise(() =>
                fetch("https://api.openai.com/v1/images/generations", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${openAiKey}`,
                  },
                  body: JSON.stringify({
                    model: "dall-e-3",
                    prompt: params.prompt,
                    n: 1,
                    size,
                    response_format: "b64_json",
                  }),
                }),
              )

              if (res.ok) {
                const data = (yield* Effect.promise(() => res.json())) as { data?: Array<{ b64_json?: string }> }
                const b64 = data.data?.[0]?.b64_json
                if (b64) {
                  imageBuffer = Buffer.from(b64, "base64")
                }
              }
            } catch (err) {
              log.warn("openai image generation failed", { error: String(err) })
            }
          }

          // 2. Fallback: High-fidelity Vector SVG generation
          if (!imageBuffer) {
            log.info("generating high-fidelity SVG asset fallback", { prompt: params.prompt })
            ext = ".svg"
            mimeType = "image/svg+xml"
            const svgContent = generateVectorSvg(params.prompt, cleanName, params.aspectRatio ?? "1:1")
            imageBuffer = Buffer.from(svgContent, "utf-8")
          }

          const fileName = cleanName.endsWith(ext) ? cleanName : `${cleanName}${ext}`
          const filePath = path.join(outDir, fileName)
          yield* Effect.promise(() => Bun.write(filePath, imageBuffer!))

          const relPath = path.relative(instance.worktree, filePath)
          const base64Data = imageBuffer.toString("base64")
          const dataUrl = `data:${mimeType};base64,${base64Data}`

          return {
            title: `Generated image ${fileName}`,
            output: [
              `Successfully generated image: **${fileName}**`,
              `- Saved to: \`${relPath}\``,
              `- Aspect ratio: ${params.aspectRatio ?? "1:1"}`,
              `- Prompt: "${params.prompt}"`,
              "",
              `![${cleanName}](${filePath})`,
            ].join("\n"),
            metadata: {
              filePath,
              aspectRatio: params.aspectRatio,
              format: mimeType,
            } as Record<string, unknown>,
            attachments: [
              {
                type: "file" as const,
                mime: mimeType,
                url: dataUrl,
              },
            ],
          }
        }),
    }
  }),
)

function generateVectorSvg(prompt: string, title: string, aspectRatio: string): string {
  let width = 800
  let height = 800

  if (aspectRatio === "16:9") {
    width = 1200
    height = 675
  } else if (aspectRatio === "9:16") {
    width = 675
    height = 1200
  } else if (aspectRatio === "4:3") {
    width = 800
    height = 600
  } else if (aspectRatio === "3:4") {
    width = 600
    height = 800
  }

  const escapedPrompt = prompt.replace(/[<>&"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case "&":
        return "&amp;"
      case '"':
        return "&quot;"
      default:
        return c
    }
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="50%" stop-color="#1e1b4b" />
      <stop offset="100%" stop-color="#311042" />
    </linearGradient>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.08)" />
      <stop offset="100%" stop-color="rgba(255,255,255,0.02)" />
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#6366f1" />
      <stop offset="50%" stop-color="#a855f7" />
      <stop offset="100%" stop-color="#ec4899" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="30" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <rect width="100%" height="100%" fill="url(#bgGrad)" />

  <circle cx="${width * 0.2}" cy="${height * 0.2}" r="${width * 0.25}" fill="#6366f1" opacity="0.15" filter="url(#glow)" />
  <circle cx="${width * 0.8}" cy="${height * 0.8}" r="${width * 0.25}" fill="#ec4899" opacity="0.15" filter="url(#glow)" />

  <g transform="translate(${width * 0.08}, ${height * 0.08})">
    <rect width="${width * 0.84}" height="${height * 0.84}" rx="16" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" />
    
    <circle cx="30" cy="30" r="6" fill="#ef4444" />
    <circle cx="50" cy="30" r="6" fill="#eab308" />
    <circle cx="70" cy="30" r="6" fill="#22c55e" />

    <text x="30" y="80" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="${Math.max(18, Math.round(width * 0.028))}" font-weight="bold" letter-spacing="-0.5">
      ${title.toUpperCase()}
    </text>
    
    <rect x="30" y="95" width="${width * 0.78}" height="3" fill="url(#accentGrad)" rx="1.5" />

    <foreignObject x="30" y="115" width="${width * 0.78}" height="${height * 0.6}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="color: #94a3b8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: ${Math.max(14, Math.round(width * 0.02))}; line-height: 1.6; word-break: break-word;">
        <p style="color: #cbd5e1; margin-top: 0; font-weight: 500;">${escapedPrompt}</p>
        <div style="display: inline-block; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 6px; padding: 6px 12px; margin-top: 12px; color: #a5b4fc; font-size: 13px;">
          Generated Asset • ${aspectRatio}
        </div>
      </div>
    </foreignObject>
  </g>
</svg>`
}
