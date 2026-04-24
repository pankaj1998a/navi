import z from "zod"
import { Tool } from "./tool"
import { BrowserSession } from "./browser/session"
import { Log } from "../util/log"

const log = Log.create({ service: "browser-tool" })

// Singleton session for now
const session = new BrowserSession()

export const BrowserTool = Tool.define("browser_action", async () => {
    return {
        description: `Interact with a browser to test web applications, verify UI, or gather information.
Capabilities:
- Launch a browser at a URL
- Click elements at coordinates
- Type text
- Scroll
- Capture screenshots and logs

The tool returns a screenshot of the current page state, console logs, and current URL/title.`,
        parameters: z.object({
            action: z.enum(["launch", "click", "type", "scroll_down", "scroll_up", "close"]).describe("The action to perform"),
            url: z.string().optional().describe("URL to launch (only for 'launch' action)"),
            coordinate: z.string().optional().describe("x,y coordinates to click (only for 'click' action)"),
            text: z.string().optional().describe("Text to type (only for 'type' action)"),
        }),
        async execute(params, ctx) {
            log.info("executing browser action", params)

            try {
                let result
                switch (params.action) {
                    case "launch":
                        result = await session.launch(params.url)
                        break
                    case "click":
                        if (!params.coordinate) throw new Error("Coordinate required for click action")
                        result = await session.click(params.coordinate)
                        break
                    case "type":
                        if (!params.text) throw new Error("Text required for type action")
                        result = await session.type(params.text)
                        break
                    case "scroll_down":
                        result = await session.scrollDown()
                        break
                    case "scroll_up":
                        result = await session.scrollUp()
                        break
                    case "close":
                        await session.close()
                        return {
                            title: "Browser Closed",
                            output: "Browser session closed",
                            metadata: {
                                url: undefined,
                                title: undefined
                            }
                        }
                    default:
                        throw new Error(`Unknown action: ${params.action}`)
                }

                const outputParts = []
                if (result.title) outputParts.push(`Title: ${result.title}`)
                if (result.url) outputParts.push(`URL: ${result.url}`)
                if (result.logs) outputParts.push(`Logs:\n${result.logs}`)
                if (result.text) outputParts.push(`Page Text:\n${result.text.substring(0, 10000)}`)

                if (result.screenshot) outputParts.push(`[Screenshot captured]`)

                return {
                    title: `Browser Action: ${params.action}`,
                    output: outputParts.join("\n\n"),
                    metadata: {
                        url: result.url,
                        title: result.title,
                    }
                }
            } catch (error: any) {
                return {
                    title: "Browser Action Failed",
                    output: `Error: ${error.message}`,
                    metadata: {
                        error: error.message,
                        url: undefined,
                        title: undefined
                    }
                }
            }
        },
    }
})


