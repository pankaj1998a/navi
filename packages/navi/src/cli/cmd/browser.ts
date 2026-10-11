import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { getBrowser, webFetch, webScrape, autoScrape, assertSafeUrl } from "@/tool/browser-engine"
import path from "path"

export const BrowserCommand = effectCmd({
  command: "browser <action> [target]",
  describe: "Headless Chrome DevTools CLI (check, open, content, scrape, screenshot, eval, console, network, pick)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "Action to perform (check, open, content, scrape, screenshot, eval, console, network, pick)",
        type: "string",
      })
      .positional("target", {
        describe: "Target URL, selector, JavaScript code, or output filepath",
        type: "string",
      })
      .option("output", {
        alias: "o",
        describe: "Output file path for screenshot or scrape",
        type: "string",
      })
      .option("selector", {
        alias: "s",
        describe: "CSS selector for scraping",
        type: "string",
      })
      .option("script", {
        alias: "e",
        describe: "JavaScript expression to evaluate",
        type: "string",
      }),
  handler: Effect.fn("Cli.browser")(function* (args) {
    const action = args.action?.toLowerCase()
    const target = args.target

    if (action === "check" || action === "status") {
      UI.println(UI.Style.TEXT_INFO_BOLD + "Connecting to local Chrome engine...")
      const browser = yield* Effect.promise(() => getBrowser())
      const version = yield* Effect.promise(() => browser.version())
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Chrome DevTools engine connected: " + UI.Style.TEXT_NORMAL + version)
      return
    }

    if (action === "nav" || action === "open" || action === "content") {
      if (!target) return yield* fail("A target URL is required.")
      assertSafeUrl(target, { allowLocalhost: true })
      UI.println(UI.Style.TEXT_INFO_BOLD + "Fetching content from: " + UI.Style.TEXT_NORMAL + target)
      const res = yield* Effect.promise(() => webFetch(target, "markdown"))
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Title: ${res.title} (Status: ${res.statusCode})` + UI.Style.TEXT_NORMAL)
      process.stdout.write(res.content)
      return
    }

    if (action === "scrape") {
      if (!target) return yield* fail("A target URL is required.")
      assertSafeUrl(target, { allowLocalhost: true })
      if (args.selector) {
        const res = yield* Effect.promise(() =>
          webScrape(target, [{ name: "result", selector: args.selector!, multiple: true }]),
        )
        process.stdout.write(JSON.stringify(res.data, null, 2) + "\n")
      } else {
        const res = yield* Effect.promise(() => autoScrape(target))
        process.stdout.write(JSON.stringify(res.data, null, 2) + "\n")
      }
      return
    }

    if (action === "screenshot") {
      if (!target) return yield* fail("A target URL is required.")
      assertSafeUrl(target, { allowLocalhost: true })
      const browser = yield* Effect.promise(() => getBrowser())
      const page = yield* Effect.promise(() => browser.newPage())
      try {
        yield* Effect.promise(() => page.goto(target, { waitUntil: "networkidle2", timeout: 30000 }))
        const outPath = args.output ?? path.join(process.cwd(), `screenshot-${Date.now()}.png`)
        yield* Effect.promise(() => page.screenshot({ path: outPath, fullPage: true }))
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Screenshot saved to: " + UI.Style.TEXT_NORMAL + outPath)
      } finally {
        yield* Effect.promise(() => page.close().catch(() => {}))
      }
      return
    }

    if (action === "eval") {
      const code = args.script ?? target
      if (!code) return yield* fail("JavaScript code to evaluate is required.")
      const browser = yield* Effect.promise(() => getBrowser())
      const pages = yield* Effect.promise(() => browser.pages())
      const page = pages[0] ?? (yield* Effect.promise(() => browser.newPage()))
      const result = yield* Effect.promise(() =>
        page.evaluate((expr) => {
          try {
            const fn = new Function("'use strict'; return (" + expr + ")")
            return fn()
          } catch (e: any) {
            return { error: e.message }
          }
        }, code),
      )
      process.stdout.write(JSON.stringify(result, null, 2) + "\n")
      return
    }

    if (action === "console") {
      if (!target) return yield* fail("Target URL is required for console log capture.")
      assertSafeUrl(target, { allowLocalhost: true })
      UI.println(UI.Style.TEXT_INFO_BOLD + `Navigating to ${target} and streaming console logs...` + UI.Style.TEXT_NORMAL)
      const browser = yield* Effect.promise(() => getBrowser())
      const page = yield* Effect.promise(() => browser.newPage())
      try {
        page.on("console", (msg) => {
          const type = msg.type()
          const text = msg.text()
          process.stdout.write(`[CONSOLE:${type.toUpperCase()}] ${text}\n`)
        })
        page.on("pageerror", (err: unknown) => {
          process.stderr.write(`[PAGEERROR] ${err instanceof Error ? err.message : String(err)}\n`)
        })
        yield* Effect.promise(() => page.goto(target, { waitUntil: "networkidle2", timeout: 30000 }))
        yield* Effect.promise(() => new Promise((r) => setTimeout(r, 2000)))
      } finally {
        yield* Effect.promise(() => page.close().catch(() => {}))
      }
      return
    }

    if (action === "network") {
      if (!target) return yield* fail("Target URL is required for network log capture.")
      assertSafeUrl(target, { allowLocalhost: true })
      UI.println(UI.Style.TEXT_INFO_BOLD + `Navigating to ${target} and capturing network requests...` + UI.Style.TEXT_NORMAL)
      const browser = yield* Effect.promise(() => getBrowser())
      const page = yield* Effect.promise(() => browser.newPage())
      try {
        page.on("request", (req) => {
          process.stdout.write(`[REQ] ${req.method()} ${req.resourceType()} ${req.url()}\n`)
        })
        page.on("response", (res) => {
          process.stdout.write(`[RESP] ${res.status()} ${res.url()}\n`)
        })
        page.on("requestfailed", (req) => {
          process.stderr.write(`[FAIL] ${req.method()} ${req.url()} (${req.failure()?.errorText})\n`)
        })
        yield* Effect.promise(() => page.goto(target, { waitUntil: "networkidle2", timeout: 30000 }))
        yield* Effect.promise(() => new Promise((r) => setTimeout(r, 2000)))
      } finally {
        yield* Effect.promise(() => page.close().catch(() => {}))
      }
      return
    }

    if (action === "pick") {
      if (!target) return yield* fail("Target URL is required for element picking.")
      const selector = args.selector
      if (!selector) return yield* fail("CSS selector is required (--selector / -s).")
      assertSafeUrl(target, { allowLocalhost: true })
      const browser = yield* Effect.promise(() => getBrowser())
      const page = yield* Effect.promise(() => browser.newPage())
      try {
        yield* Effect.promise(() => page.goto(target, { waitUntil: "networkidle2", timeout: 30000 }))
        const pickData = yield* Effect.promise(() =>
          page.$eval(selector, (el) => {
            const rect = el.getBoundingClientRect()
            return {
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              className: el.className || null,
              component: el.getAttribute("data-component") || el.getAttribute("data-testid") || null,
              box: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
              text: el.textContent?.trim()?.slice(0, 200) || null,
            }
          }),
        )
        process.stdout.write(JSON.stringify(pickData, null, 2) + "\n")
      } finally {
        yield* Effect.promise(() => page.close().catch(() => {}))
      }
      return
    }

    return yield* fail(
      `Unknown browser action: ${action}. Available: check, open/nav/content, scrape, screenshot, eval, console, network, pick`,
    )
  }),
})
