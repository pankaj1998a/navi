import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import { getBrowser, htmlToMarkdown, htmlToText } from "./browser-engine"
import type { Page, Browser } from "puppeteer-core"
import path from "path"
import fs from "fs"
import DESCRIPTION from "./browser.txt"

const log = Log.create({ service: "tool.browser" })

export const Parameters = Schema.Struct({
  action: Schema.Literals([
    "navigate",
    "click",
    "type",
    "screenshot",
    "content",
    "evaluate",
    "wait",
    "close",
  ]).annotate({
    description: "The browser action to perform: navigate, click, type, screenshot, content, evaluate, wait, or close",
  }),
  url: Schema.optional(Schema.String).annotate({ description: "URL to navigate to (required for 'navigate' action)" }),
  selector: Schema.optional(Schema.String).annotate({
    description: "CSS selector for click, type, or wait actions (e.g. 'button#submit', 'input[name=\"email\"]')",
  }),
  text: Schema.optional(Schema.String).annotate({
    description: "Text to type for 'type' action, or element text match for 'click' action",
  }),
  script: Schema.optional(Schema.String).annotate({
    description: "JavaScript expression or function body to execute on the page for 'evaluate' action",
  }),
  duration: Schema.optional(Schema.Number).annotate({
    description: "Time to wait in milliseconds for 'wait' action (default 1000ms)",
  }),
  fullPage: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to capture full page screenshot (for 'screenshot' action, default false)",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Optional custom name for saved screenshot file",
  }),
  format: Schema.Literals(["markdown", "text", "html"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("markdown" as const)))
    .annotate({ description: "Output format for 'content' action (markdown, text, or html)" }),
})

// Session-scoped active pages
const activePages = new Map<string, Page>()

async function getOrCreatePage(sessionID: string, browser: Browser): Promise<Page> {
  let page = activePages.get(sessionID)
  if (page && !page.isClosed()) {
    return page
  }

  page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  )

  page.on("close", () => {
    activePages.delete(sessionID)
  })

  activePages.set(sessionID, page)
  return page
}

export const BrowserTool = Tool.define(
  "browser",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context

          yield* ctx.ask({
            permission: "browser",
            patterns: [params.action, params.url ?? "*"],
            always: ["*"],
            metadata: {
              action: params.action,
              url: params.url,
              selector: params.selector,
            },
          })

          const browserInstance = yield* Effect.promise(async () => {
            try {
              return await getBrowser()
            } catch {
              return null
            }
          })

          if (!browserInstance) {
            return {
              title: "Browser unavailable",
              output: "Failed to launch browser. Ensure Chrome, Edge, or Chromium is installed on the system.",
              metadata: { action: params.action } as Record<string, unknown>,
            }
          }

          if (params.action === "close") {
            yield* Effect.promise(async () => {
              const p = activePages.get(ctx.sessionID)
              if (p && !p.isClosed()) {
                await p.close().catch(() => {})
              }
              activePages.delete(ctx.sessionID)
            })

            const isClosed = !activePages.has(ctx.sessionID) || (activePages.get(ctx.sessionID)?.isClosed() ?? true)

            return {
              title: "Closed Browser Page",
              output: isClosed
                ? "✅ Browser page successfully closed and verified. Session memory freed."
                : "⚠️ Browser page close requested; awaiting final teardown.",
              metadata: { action: "close", closed: isClosed } as Record<string, unknown>,
            }
          }

          const page = yield* Effect.promise(() => getOrCreatePage(ctx.sessionID, browserInstance))

          switch (params.action) {
            case "navigate": {
              if (!params.url) throw new Error("Parameter 'url' is required for action 'navigate'")
              const targetUrl = params.url
              log.info("navigating browser", { url: targetUrl })
              const navResult = yield* Effect.promise(async () => {
                await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
                await new Promise((r) => setTimeout(r, 600))
                const title = await page.title()
                const currentUrl = page.url()
                return { title, currentUrl }
              })

              return {
                title: `Navigated to ${navResult.currentUrl}`,
                output: `Browser navigated to: **${navResult.currentUrl}**\nPage Title: "${navResult.title}"`,
                metadata: { action: "navigate", url: navResult.currentUrl, title: navResult.title } as Record<string, unknown>,
              }
            }

            case "click": {
              if (!params.selector && !params.text) {
                throw new Error("Either 'selector' or 'text' is required for action 'click'")
              }

              const clickResult = yield* Effect.promise(async () => {
                if (params.selector) {
                  await page.waitForSelector(params.selector, { timeout: 10_000 })
                  await page.click(params.selector)
                } else if (params.text) {
                  const clicked = await page.evaluate((textToFind) => {
                    const elements = Array.from(document.querySelectorAll("button, a, input[type='submit'], [role='button']"))
                    const el = elements.find((e) => (e as HTMLElement).innerText?.includes(textToFind) || (e as HTMLElement).textContent?.includes(textToFind))
                    if (el) {
                      ;(el as HTMLElement).click()
                      return true
                    }
                    return false
                  }, params.text)

                  if (!clicked) {
                    throw new Error(`Could not find clickable element matching text "${params.text}"`)
                  }
                }

                await new Promise((r) => setTimeout(r, 500))
                return {
                  currentUrl: page.url(),
                  title: await page.title(),
                }
              })

              return {
                title: `Clicked element`,
                output: `Clicked ${params.selector ? `selector \`${params.selector}\`` : `text "${params.text}"`}.\nCurrent page: ${clickResult.currentUrl} ("${clickResult.title}")`,
                metadata: { action: "click", url: clickResult.currentUrl, title: clickResult.title } as Record<string, unknown>,
              }
            }

            case "type": {
              if (!params.selector) throw new Error("Parameter 'selector' is required for action 'type'")
              if (params.text === undefined) throw new Error("Parameter 'text' is required for action 'type'")

              const sel = params.selector
              const val = params.text
              yield* Effect.promise(async () => {
                await page.waitForSelector(sel, { timeout: 10_000 })
                await page.click(sel)
                await page.type(sel, val)
              })

              return {
                title: `Typed into ${params.selector}`,
                output: `Typed "${params.text}" into \`${params.selector}\`.`,
                metadata: { action: "type" } as Record<string, unknown>,
              }
            }

            case "screenshot": {
              const outDir = path.resolve(instance.directory, ".navi", "artifacts", "screenshots")
              if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true })
              }

              const shotName = params.name
                ? params.name.replace(/[^a-zA-Z0-9_-]/g, "_")
                : `screenshot_${Date.now()}`
              const filePath = path.join(outDir, `${shotName}.png`)

              const shotData = yield* Effect.promise(async () => {
                const buffer = await page.screenshot({
                  fullPage: params.fullPage ?? false,
                  path: filePath,
                })
                const base64Data = Buffer.from(buffer).toString("base64")
                const title = await page.title()
                const url = page.url()
                return { base64Data, title, url }
              })

              const dataUrl = `data:image/png;base64,${shotData.base64Data}`
              const relPath = path.relative(instance.worktree, filePath)

              return {
                title: `Captured screenshot ${shotName}`,
                output: [
                  `Captured screenshot of: **${shotData.url}** ("${shotData.title}")`,
                  `- Saved to: \`${relPath}\``,
                  `- Full page: ${params.fullPage ? "yes" : "no"}`,
                  "",
                  `![${shotName}](${filePath})`,
                ].join("\n"),
                metadata: { action: "screenshot", screenshotPath: filePath, url: shotData.url } as Record<string, unknown>,
                attachments: [
                  {
                    type: "file" as const,
                    mime: "image/png",
                    url: dataUrl,
                  },
                ],
              }
            }

            case "content": {
              const pageData = yield* Effect.promise(async () => {
                const html = await page.content()
                const title = await page.title()
                const url = page.url()
                return { html, title, url }
              })

              let content = pageData.html
              if (params.format === "text") {
                content = htmlToText(pageData.html)
              } else if (params.format === "markdown" || !params.format) {
                content = htmlToMarkdown(pageData.html)
              }

              return {
                title: `Content of ${pageData.url}`,
                output: [
                  `# ${pageData.title}`,
                  `**URL**: ${pageData.url}`,
                  "---",
                  content.slice(0, 15000),
                  content.length > 15000 ? "\n\n... (content truncated)" : "",
                ].join("\n"),
                metadata: { action: "content", url: pageData.url, title: pageData.title } as Record<string, unknown>,
              }
            }

            case "evaluate": {
              if (!params.script) throw new Error("Parameter 'script' is required for action 'evaluate'")
              const scriptToRun = params.script

              const result = yield* Effect.promise(() =>
                page.evaluate((code) => {
                  // eslint-disable-next-line no-eval
                  return eval(code)
                }, scriptToRun),
              )

              const stringified = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result)

              return {
                title: "JavaScript Evaluated",
                output: `Result of script evaluation:\n\`\`\`json\n${stringified}\n\`\`\``,
                metadata: { action: "evaluate" } as Record<string, unknown>,
              }
            }

            case "wait": {
              if (params.selector) {
                const sel = params.selector
                const dur = params.duration ?? 10_000
                yield* Effect.promise(() => page.waitForSelector(sel, { timeout: dur }))
                return {
                  title: `Waited for selector ${params.selector}`,
                  output: `Selector \`${params.selector}\` appeared on the page.`,
                  metadata: { action: "wait" } as Record<string, unknown>,
                }
              } else {
                const waitMs = params.duration ?? 1000
                yield* Effect.promise(() => new Promise((r) => setTimeout(r, waitMs)))
                return {
                  title: `Waited ${waitMs}ms`,
                  output: `Waited for ${waitMs} milliseconds.`,
                  metadata: { action: "wait" } as Record<string, unknown>,
                }
              }
            }

            default:
              throw new Error(`Unknown browser action: ${params.action}`)
          }
        }),
    }
  }),
)
