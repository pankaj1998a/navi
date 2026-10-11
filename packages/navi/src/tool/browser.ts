import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import { Hash } from "@navi-ai/core/util/hash"
import { getBrowser, htmlToMarkdown, htmlToText } from "./browser-engine"
import type { Page, Browser, HTTPRequest, KeyInput } from "puppeteer-core"
import path from "path"
import fs from "fs"
import DESCRIPTION from "./browser.txt"

const log = Log.create({ service: "tool.browser" })

const EVALUATE_MAX_LENGTH = 10_000
const EVALUATE_TIMEOUT_MS = 10_000

function safeStringify(value: unknown): string {
  const seen = new Set<object>()
  try {
    return JSON.stringify(
      value,
      (_key, val: unknown) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val as object)) return "[Circular]"
          seen.add(val as object)
        }
        if (typeof val === "function") return "[Function]"
        if (typeof val === "bigint") return `${val}n`
        return val as object
      },
      2,
    ) ?? String(value)
  } catch {
    try {
      return String(value)
    } catch {
      return "[Unserializable]"
    }
  }
}

export const Parameters = Schema.Struct({
  action: Schema.Literals([
    "navigate",
    "click",
    "mouse_click",
    "box",
    "pick",
    "console",
    "network",
    "press_key",
    "scroll",
    "viewport",
    "cookies",
    "tabs",
    "new_tab",
    "switch_tab",
    "close_tab",
    "type",
    "screenshot",
    "content",
    "evaluate",
    "wait",
    "close",
  ]).annotate({
    description: "The browser action to perform: navigate, click, mouse_click, box, pick, console, network, press_key, scroll, viewport, cookies, tabs, new_tab, switch_tab, close_tab, type, screenshot, content, evaluate, wait, or close",
  }),
  url: Schema.optional(Schema.String).annotate({ description: "URL to navigate to (required for 'navigate' and optional for 'new_tab')" }),
  selector: Schema.optional(Schema.String).annotate({
    description: "CSS selector for click, box, pick, scroll, type, or wait actions (e.g. 'button#submit', 'input[name=\"email\"]')",
  }),
  coordinate: Schema.optional(
    Schema.Struct({
      x: Schema.Number,
      y: Schema.Number,
    }),
  ).annotate({ description: "X and Y viewport coordinates for 'mouse_click' or 'pick' action" }),
  key: Schema.optional(Schema.String).annotate({
    description: "Key name to press for 'press_key' action (e.g. 'Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'Backspace')",
  }),
  scrollDelta: Schema.optional(
    Schema.Struct({
      x: Schema.optional(Schema.Number),
      y: Schema.optional(Schema.Number),
    }),
  ).annotate({ description: "X and Y pixel deltas to scroll for 'scroll' action" }),
  viewportSize: Schema.optional(
    Schema.Struct({
      width: Schema.Number,
      height: Schema.Number,
      isMobile: Schema.optional(Schema.Boolean),
    }),
  ).annotate({ description: "Viewport dimensions for 'viewport' action (e.g. { width: 375, height: 812, isMobile: true })" }),
  tabIndex: Schema.optional(Schema.Number).annotate({
    description: "0-based tab index for 'switch_tab' or 'close_tab' action",
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
  freezeAnimations: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to pause all CSS animations, transitions, and media before capturing screenshot (for deterministic capture)",
  }),
  format: Schema.Literals(["markdown", "text", "html"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("markdown" as const)))
    .annotate({ description: "Output format for 'content' action (markdown, text, or html)" }),
})

interface NetworkLogItem {
  type: "req" | "resp" | "fail"
  method?: string
  url: string
  resourceType?: string
  status?: number
  durationMs?: number
  error?: string
  time: number
}

interface SessionBrowserState {
  pages: Page[]
  activePageIndex: number
  consoleLogs: Array<{ type: string; text: string; time: number }>
  networkLogs: NetworkLogItem[]
}

const sessionStates = new Map<string, SessionBrowserState>()
const requestTimes = new WeakMap<HTTPRequest, number>()

function attachPageListeners(page: Page, state: SessionBrowserState) {
  page.on("console", (msg) => {
    state.consoleLogs.push({ type: msg.type(), text: msg.text(), time: Date.now() })
    if (state.consoleLogs.length > 200) state.consoleLogs.shift()
  })

  page.on("pageerror", (err) => {
    state.consoleLogs.push({ type: "error", text: String(err), time: Date.now() })
    if (state.consoleLogs.length > 200) state.consoleLogs.shift()
  })

  page.on("request", (req) => {
    requestTimes.set(req, Date.now())
    state.networkLogs.push({
      type: "req",
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      time: Date.now(),
    })
    if (state.networkLogs.length > 200) state.networkLogs.shift()
  })

  page.on("response", (resp) => {
    const req = resp.request()
    const start = requestTimes.get(req)
    state.networkLogs.push({
      type: "resp",
      method: req.method(),
      url: resp.url(),
      resourceType: req.resourceType(),
      status: resp.status(),
      durationMs: start !== undefined ? Date.now() - start : undefined,
      time: Date.now(),
    })
    if (state.networkLogs.length > 200) state.networkLogs.shift()
  })

  page.on("requestfailed", (req) => {
    state.networkLogs.push({
      type: "fail",
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      error: req.failure()?.errorText || "unknown",
      time: Date.now(),
    })
    if (state.networkLogs.length > 200) state.networkLogs.shift()
  })
}

async function getOrCreateSessionState(sessionID: string, browser: Browser): Promise<SessionBrowserState> {
  let state = sessionStates.get(sessionID)
  if (!state) {
    state = {
      pages: [],
      activePageIndex: 0,
      consoleLogs: [],
      networkLogs: [],
    }
    sessionStates.set(sessionID, state)
  }

  // Filter out any closed pages
  state.pages = state.pages.filter((p) => !p.isClosed())

  if (state.pages.length === 0) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    )
    attachPageListeners(page, state)
    state.pages.push(page)
    state.activePageIndex = 0
  }

  if (state.activePageIndex >= state.pages.length) {
    state.activePageIndex = Math.max(0, state.pages.length - 1)
  }

  return state
}

function getActivePageFromState(state: SessionBrowserState): Page {
  const page = state.pages[state.activePageIndex]
  if (!page || page.isClosed()) {
    throw new Error("No active browser page in session")
  }
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
              const state = sessionStates.get(ctx.sessionID)
              if (state) {
                for (const p of state.pages) {
                  if (!p.isClosed()) {
                    await p.close().catch(() => {})
                  }
                }
              }
              sessionStates.delete(ctx.sessionID)
            })

            return {
              title: "Closed Browser Session",
              output: "✅ All browser tabs in session successfully closed and memory freed.",
              metadata: { action: "close", closed: true } as Record<string, unknown>,
            }
          }

          const sessionState = yield* Effect.promise(() => getOrCreateSessionState(ctx.sessionID, browserInstance))
          const page = getActivePageFromState(sessionState)

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

            case "mouse_click": {
              if (!params.coordinate) {
                throw new Error("Parameter 'coordinate' with x and y is required for action 'mouse_click'")
              }
              const { x, y } = params.coordinate
              log.info("browser coordinate click", { x, y })
              yield* Effect.promise(async () => {
                await page.mouse.move(x, y)
                await page.mouse.down({ button: "left" })
                await page.mouse.up({ button: "left" })
                await new Promise((r) => setTimeout(r, 400))
              })
              return {
                title: `Clicked at (${x}, ${y})`,
                output: `Executed coordinate click at (${x}, ${y}).`,
                metadata: { action: "mouse_click", x, y, url: page.url() } as Record<string, unknown>,
              }
            }

            case "box": {
              if (!params.selector) throw new Error("Parameter 'selector' is required for action 'box'")
              const sel = params.selector
              const box = yield* Effect.promise(async () => {
                await page.waitForSelector(sel, { timeout: 10_000 })
                return await page.$eval(sel, (el) => {
                  const r = el.getBoundingClientRect()
                  return {
                    x: Math.round(r.x),
                    y: Math.round(r.y),
                    width: Math.round(r.width),
                    height: Math.round(r.height),
                    centerX: Math.round(r.x + r.width / 2),
                    centerY: Math.round(r.y + r.height / 2),
                  }
                })
              })
              return {
                title: `Bounding box for ${sel}`,
                output: `Bounding box for \`${sel}\`:\n- x: ${box.x}, y: ${box.y}\n- width: ${box.width}, height: ${box.height}\n- center: (${box.centerX}, ${box.centerY})`,
                metadata: { action: "box", selector: sel, ...box } as Record<string, unknown>,
              }
            }

            case "console": {
              const logs = sessionState.consoleLogs
              const formatted =
                logs.length === 0
                  ? "No console messages recorded."
                  : logs
                      .slice(-50)
                      .map((l) => `[${new Date(l.time).toISOString().slice(11, 19)}] [${l.type.toUpperCase()}] ${l.text}`)
                      .join("\n")
              return {
                title: "Browser Console Logs",
                output: `Captured browser console messages (${logs.length} total):\n\`\`\`\n${formatted}\n\`\`\``,
                metadata: { action: "console", count: logs.length } as Record<string, unknown>,
              }
            }

            case "network": {
              const logs = sessionState.networkLogs
              if (logs.length === 0) {
                return {
                  title: "Network Activity",
                  output: "No network requests recorded for this session yet.",
                  metadata: { action: "network", count: 0 } as Record<string, unknown>,
                }
              }

              const formatted = logs
                .slice(-60)
                .map((item) => {
                  const time = new Date(item.time).toISOString().slice(11, 19)
                  if (item.type === "req") {
                    return `[REQ ] ${time} ${item.method || "GET"} ${item.resourceType || "other"} ${item.url}`
                  }
                  if (item.type === "resp") {
                    const dur = item.durationMs !== undefined ? ` (${item.durationMs}ms)` : ""
                    return `[RESP] ${time} ${item.status} ${item.method || "GET"} ${item.resourceType || "other"} ${item.url}${dur}`
                  }
                  return `[FAIL] ${time} ${item.method || "GET"} ${item.resourceType || "other"} ${item.url} (${item.error})`
                })
                .join("\n")

              return {
                title: "Network Activity Log",
                output: `Captured network requests (${logs.length} total):\n\`\`\`\n${formatted}\n\`\`\``,
                metadata: { action: "network", count: logs.length } as Record<string, unknown>,
              }
            }

            case "pick": {
              const pickResult = yield* Effect.promise(async () => {
                if (params.selector) {
                  await page.waitForSelector(params.selector, { timeout: 10_000 })
                  return await page.$eval(params.selector, (el) => {
                    const parents: string[] = []
                    let curr = el.parentElement
                    while (curr && curr !== document.body) {
                      const id = curr.id ? `#${curr.id}` : ""
                      const cls =
                        curr.className && typeof curr.className === "string"
                          ? `.${curr.className.trim().split(/\s+/).join(".")}`
                          : ""
                      parents.push(`${curr.tagName.toLowerCase()}${id}${cls}`)
                      curr = curr.parentElement
                    }
                    const rect = el.getBoundingClientRect()
                    const getAttrs = (element: Element) => {
                      const res: Record<string, string> = {}
                      for (const a of ["data-testid", "data-test", "data-component", "data-qa", "data-cy", "aria-label", "role", "name"]) {
                        const v = element.getAttribute(a)
                        if (v) res[a] = v
                      }
                      return res
                    }
                    const getReactInfo = (element: Element) => {
                      try {
                        const keys = Object.keys(element)
                        const fiberKey = keys.find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
                        if (!fiberKey) return null
                        let fiber = (element as any)[fiberKey]
                        let depth = 0
                        let compName: string | null = null
                        let srcLoc: string | null = null
                        while (fiber && depth < 30) {
                          if (!compName && fiber.type) {
                            if (typeof fiber.type === "function") compName = fiber.type.displayName || fiber.type.name || null
                            else if (typeof fiber.type === "object") compName = fiber.type.displayName || fiber.type.name || null
                          }
                          if (!srcLoc) {
                            const s = fiber._debugSource || fiber._debugOwner?._debugSource
                            if (s && s.fileName) srcLoc = `${s.fileName}:${s.lineNumber || 1}`
                          }
                          if (compName && srcLoc) break
                          fiber = fiber.return
                          depth++
                        }
                        return { compName, srcLoc }
                      } catch {
                        return null
                      }
                    }
                    const attrs = getAttrs(el)
                    const reactData = getReactInfo(el)
                    return {
                      tag: el.tagName.toLowerCase(),
                      id: el.id || null,
                      className: typeof el.className === "string" ? el.className : null,
                      text: el.textContent?.trim()?.slice(0, 300) || null,
                      html: el.outerHTML.slice(0, 600),
                      hierarchy: parents.reverse().join(" > ") + ` > ${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`,
                      attrs,
                      component: reactData?.compName || attrs["data-component"] || attrs["data-testid"] || null,
                      reactSource: reactData?.srcLoc || null,
                      box: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                      },
                    }
                  })
                } else if (params.coordinate) {
                  const { x, y } = params.coordinate
                  return await page.evaluate((cx, cy) => {
                    const el = document.elementFromPoint(cx, cy)
                    if (!el) return null
                    const parents: string[] = []
                    let curr = el.parentElement
                    while (curr && curr !== document.body) {
                      const id = curr.id ? `#${curr.id}` : ""
                      const cls =
                        curr.className && typeof curr.className === "string"
                          ? `.${curr.className.trim().split(/\s+/).join(".")}`
                          : ""
                      parents.push(`${curr.tagName.toLowerCase()}${id}${cls}`)
                      curr = curr.parentElement
                    }
                    const rect = el.getBoundingClientRect()
                    const getAttrs = (element: Element) => {
                      const res: Record<string, string> = {}
                      for (const a of ["data-testid", "data-test", "data-component", "data-qa", "data-cy", "aria-label", "role", "name"]) {
                        const v = element.getAttribute(a)
                        if (v) res[a] = v
                      }
                      return res
                    }
                    const getReactInfo = (element: Element) => {
                      try {
                        const keys = Object.keys(element)
                        const fiberKey = keys.find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
                        if (!fiberKey) return null
                        let fiber = (element as any)[fiberKey]
                        let depth = 0
                        let compName: string | null = null
                        let srcLoc: string | null = null
                        while (fiber && depth < 30) {
                          if (!compName && fiber.type) {
                            if (typeof fiber.type === "function") compName = fiber.type.displayName || fiber.type.name || null
                            else if (typeof fiber.type === "object") compName = fiber.type.displayName || fiber.type.name || null
                          }
                          if (!srcLoc) {
                            const s = fiber._debugSource || fiber._debugOwner?._debugSource
                            if (s && s.fileName) srcLoc = `${s.fileName}:${s.lineNumber || 1}`
                          }
                          if (compName && srcLoc) break
                          fiber = fiber.return
                          depth++
                        }
                        return { compName, srcLoc }
                      } catch {
                        return null
                      }
                    }
                    const attrs = getAttrs(el)
                    const reactData = getReactInfo(el)
                    return {
                      tag: el.tagName.toLowerCase(),
                      id: el.id || null,
                      className: typeof el.className === "string" ? el.className : null,
                      text: el.textContent?.trim()?.slice(0, 300) || null,
                      html: el.outerHTML.slice(0, 600),
                      hierarchy: parents.reverse().join(" > ") + ` > ${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`,
                      attrs,
                      component: reactData?.compName || attrs["data-component"] || attrs["data-testid"] || null,
                      reactSource: reactData?.srcLoc || null,
                      box: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                      },
                    }
                  }, x, y)
                } else {
                  throw new Error("Action 'pick' requires either 'selector' or 'coordinate'")
                }
              })

              if (!pickResult) {
                return {
                  title: "Element not found",
                  output: "No element found at specified selector or viewport coordinate.",
                  metadata: { action: "pick" } as Record<string, unknown>,
                }
              }

              const attrEntries = pickResult.attrs ? Object.entries(pickResult.attrs) : []
              const attrStr =
                attrEntries.length > 0
                  ? `- **Attributes**: ${attrEntries.map(([k, v]) => `\`${k}="${v}"\``).join(", ")}`
                  : ""

              return {
                title: `Inspected <${pickResult.tag}>`,
                output: [
                  `**Hierarchy**: \`${pickResult.hierarchy}\``,
                  `- **Tag**: \`${pickResult.tag}\``,
                  pickResult.component ? `- **Component / Test ID**: \`<${pickResult.component}>\`` : "",
                  pickResult.reactSource ? `- **React Source File**: \`${pickResult.reactSource}\`` : "",
                  attrStr,
                  pickResult.id ? `- **ID**: \`#${pickResult.id}\`` : "",
                  pickResult.className ? `- **Class**: \`${pickResult.className}\`` : "",
                  `- **Box**: (${pickResult.box.x}, ${pickResult.box.y}) ${pickResult.box.width}x${pickResult.box.height}`,
                  pickResult.text ? `- **Text**: "${pickResult.text}"` : "",
                  "",
                  "```html",
                  pickResult.html,
                  "```",
                ]
                  .filter(Boolean)
                  .join("\n"),
                metadata: { action: "pick", ...pickResult } as Record<string, unknown>,
              }
            }

            case "press_key": {
              if (!params.key) throw new Error("Parameter 'key' is required for action 'press_key'")
              const keyToPress = params.key
              yield* Effect.promise(async () => {
                await page.keyboard.press(keyToPress as KeyInput)
                await new Promise((r) => setTimeout(r, 200))
              })
              return {
                title: `Pressed Key: ${keyToPress}`,
                output: `Successfully dispatched keyboard key event: \`${keyToPress}\`.`,
                metadata: { action: "press_key", key: keyToPress } as Record<string, unknown>,
              }
            }

            case "scroll": {
              if (params.selector) {
                yield* Effect.promise(() =>
                  page.$eval(params.selector!, (el) => el.scrollIntoView({ behavior: "smooth", block: "center" })),
                )
                return {
                  title: `Scrolled to ${params.selector}`,
                  output: `Scrolled element \`${params.selector}\` into center view.`,
                  metadata: { action: "scroll", selector: params.selector } as Record<string, unknown>,
                }
              }
              const dx = params.scrollDelta?.x ?? 0
              const dy = params.scrollDelta?.y ?? 0
              yield* Effect.promise(() => page.evaluate((x, y) => window.scrollBy(x, y), dx, dy))
              return {
                title: `Scrolled Viewport`,
                output: `Scrolled viewport by (${dx}px, ${dy}px).`,
                metadata: { action: "scroll", dx, dy } as Record<string, unknown>,
              }
            }

            case "viewport": {
              if (!params.viewportSize) {
                throw new Error("Parameter 'viewportSize' with width and height is required for action 'viewport'")
              }
              const { width, height, isMobile } = params.viewportSize
              yield* Effect.promise(() =>
                page.setViewport({
                  width,
                  height,
                  isMobile: isMobile ?? false,
                  hasTouch: isMobile ?? false,
                }),
              )
              return {
                title: `Viewport Resized`,
                output: `Resized viewport to ${width}x${height}${isMobile ? " (mobile viewport emulated)" : ""}.`,
                metadata: { action: "viewport", width, height, isMobile } as Record<string, unknown>,
              }
            }

            case "cookies": {
              const cookies = yield* Effect.promise(() => page.cookies())
              return {
                title: `Session Cookies (${cookies.length})`,
                output: `Retrieved ${cookies.length} cookie(s) from current domain:\n\`\`\`json\n${JSON.stringify(cookies, null, 2)}\n\`\`\``,
                metadata: { action: "cookies", count: cookies.length } as Record<string, unknown>,
              }
            }

            case "tabs": {
              const tabList = yield* Effect.promise(async () => {
                return await Promise.all(
                  sessionState.pages.map(async (p, i) => ({
                    index: i,
                    title: await p.title().catch(() => "Untitled"),
                    url: p.url(),
                    active: i === sessionState.activePageIndex,
                  })),
                )
              })
              const formatted = tabList
                .map((t) => `${t.active ? "👉 " : "   "}[${t.index}] ${t.title} (${t.url})`)
                .join("\n")
              return {
                title: `Open Tabs (${tabList.length})`,
                output: `Open browser tabs in session:\n${formatted}`,
                metadata: { action: "tabs", count: tabList.length, tabs: tabList } as Record<string, unknown>,
              }
            }

            case "new_tab": {
              const newPage = yield* Effect.promise(async () => {
                const p = await browserInstance.newPage()
                await p.setViewport({ width: 1280, height: 800 })
                attachPageListeners(p, sessionState)
                sessionState.pages.push(p)
                sessionState.activePageIndex = sessionState.pages.length - 1
                if (params.url) {
                  await p.goto(params.url, { waitUntil: "domcontentloaded", timeout: 30_000 })
                }
                return p
              })
              return {
                title: `Opened New Tab [${sessionState.activePageIndex}]`,
                output: `Opened new tab [${sessionState.activePageIndex}] at: ${newPage.url() || "about:blank"}`,
                metadata: { action: "new_tab", tabIndex: sessionState.activePageIndex, url: newPage.url() } as Record<string, unknown>,
              }
            }

            case "switch_tab": {
              if (params.tabIndex === undefined || params.tabIndex < 0 || params.tabIndex >= sessionState.pages.length) {
                throw new Error(`Invalid tabIndex. Valid range: 0-${sessionState.pages.length - 1}`)
              }
              sessionState.activePageIndex = params.tabIndex
              const activeP = sessionState.pages[sessionState.activePageIndex]
              if (!activeP) throw new Error(`Tab [${params.tabIndex}] not found`)
              yield* Effect.promise(() => activeP.bringToFront().catch(() => {}))
              const tabTitle = yield* Effect.promise(() => activeP.title().catch(() => ""))
              return {
                title: `Switched Tab to [${sessionState.activePageIndex}]`,
                output: `Active tab is now [${sessionState.activePageIndex}]: "${tabTitle}" (${activeP.url()})`,
                metadata: { action: "switch_tab", tabIndex: sessionState.activePageIndex, url: activeP.url() } as Record<string, unknown>,
              }
            }

            case "close_tab": {
              const targetIdx = params.tabIndex ?? sessionState.activePageIndex
              if (targetIdx < 0 || targetIdx >= sessionState.pages.length) {
                throw new Error(`Invalid tabIndex: ${targetIdx}`)
              }
              yield* Effect.promise(async () => {
                const targetP = sessionState.pages[targetIdx]
                if (targetP && !targetP.isClosed()) {
                  await targetP.close().catch(() => {})
                }
                sessionState.pages.splice(targetIdx, 1)
                sessionState.activePageIndex = Math.max(0, sessionState.pages.length - 1)
              })
              return {
                title: `Closed Tab [${targetIdx}]`,
                output: `Closed tab [${targetIdx}]. Remaining open tabs: ${sessionState.pages.length}.`,
                metadata: { action: "close_tab", closedIndex: targetIdx, remaining: sessionState.pages.length } as Record<string, unknown>,
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
              if (scriptToRun.length > EVALUATE_MAX_LENGTH) {
                throw new Error(`Parameter 'script' exceeds maximum length of ${EVALUATE_MAX_LENGTH}`)
              }
              const scriptHash = Hash.fast(scriptToRun)
              const trusted = process.env.NAVI_BROWSER_ALLOW_EVAL === "1" || process.env.NAVI_TRUST_BROWSER_EVAL === "1"
              if (!trusted) {
                yield* ctx.ask({
                  permission: "browser.evaluate",
                  patterns: [
                    scriptToRun.length > 200
                      ? `${scriptToRun.slice(0, 200)}... [hash:${scriptHash}]`
                      : scriptToRun,
                  ],
                  always: [],
                  metadata: { action: "evaluate", scriptHash, length: scriptToRun.length },
                })
              }
              log.info("browser evaluate", { scriptHash, length: scriptToRun.length })

              const result = yield* Effect.promise(() =>
                Promise.race([
                  page.evaluate((code) => {
                    const fn = new Function("'use strict'; return (" + code + ")")
                    return fn()
                  }, scriptToRun),
                  new Promise<never>((_resolve, reject) =>
                    setTimeout(() => reject(new Error(`Evaluate timed out after ${EVALUATE_TIMEOUT_MS}ms`)), EVALUATE_TIMEOUT_MS),
                  ),
                ]).catch((e: unknown) => {
                  log.error("browser evaluate failed", { scriptHash, error: String(e) })
                  throw e
                }),
              )

              const stringified = typeof result === "object" ? safeStringify(result) : String(result)

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
