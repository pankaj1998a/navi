import * as chromeLauncher from "chrome-launcher"
import puppeteer, { Browser, Page } from "puppeteer-core"
import { Log } from "../../util/log"

const log = Log.create({ service: "browser" })

export type BrowserAction =
    | { action: "launch"; url?: string }
    | { action: "click"; coordinate: string }
    | { action: "type"; text: string }
    | { action: "scroll_down" }
    | { action: "scroll_up" }
    | { action: "close" }

export type BrowserActionResult = {
    screenshot?: string
    logs?: string
    text?: string
    url?: string
    title?: string
}

export class BrowserSession {
    private browser?: Browser
    private page?: Page
    private consoleLogs: string[] = []

    constructor() { }

    async launch(url?: string): Promise<BrowserActionResult> {
        await this.close()

        const chromePath = chromeLauncher.Launcher.getFirstInstallation()
        if (!chromePath) {
            throw new Error("Chrome installation not found")
        }

        this.browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: false,
            defaultViewport: { width: 1280, height: 800 },
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })

        const pages = await this.browser.pages()
        this.page = pages[0] || (await this.browser.newPage())

        this.page.on("console", (msg) => {
            const text = msg.text()
            if (text) this.consoleLogs.push(`[CONSOLE] ${msg.type()}: ${text}`)
        })

        this.page.on("pageerror", (err: any) => {
            this.consoleLogs.push(`[PAGE ERROR] ${err.message}`)
        })

        if (url) {
            await this.page.goto(url, { waitUntil: "domcontentloaded" })
        }

        return this.getState()
    }

    async close() {
        if (this.browser) {
            await this.browser.close()
            this.browser = undefined
            this.page = undefined
        }
    }

    async click(coordinate: string): Promise<BrowserActionResult> {
        if (!this.page) throw new Error("Browser not running")
        const [x, y] = coordinate.split(",").map(Number)
        await this.page.mouse.click(x, y)
        return this.getState()
    }

    async type(text: string): Promise<BrowserActionResult> {
        if (!this.page) throw new Error("Browser not running")
        await this.page.keyboard.type(text)
        return this.getState()
    }

    async scrollDown(): Promise<BrowserActionResult> {
        if (!this.page) throw new Error("Browser not running")
        await this.page.evaluate(() => {
            window.scrollBy(0, window.innerHeight)
        })
        return this.getState()
    }

    async scrollUp(): Promise<BrowserActionResult> {
        if (!this.page) throw new Error("Browser not running")
        await this.page.evaluate(() => {
            window.scrollBy(0, -window.innerHeight)
        })
        return this.getState()
    }

    private async getState(): Promise<BrowserActionResult> {
        if (!this.page) return {}

        // Wait a bit for things to settle
        await new Promise((resolve) => setTimeout(resolve, 500))

        const screenshot = await this.page.screenshot({ encoding: "base64", type: "jpeg", quality: 50 })
        const logs = this.consoleLogs.join("\n")
        this.consoleLogs = [] // Clear logs after reading

        const url = this.page.url()
        const title = await this.page.title()

        return {
            screenshot: screenshot as string,
            logs: logs || undefined,
            url,
            title,
        }
    }
}
