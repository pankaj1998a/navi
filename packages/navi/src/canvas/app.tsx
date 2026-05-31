import { render, useTerminalDimensions } from "@opentui/solid"
import { createSignal, Switch, Match } from "solid-js"
import { CanvasIPC } from "./ipc"
import { Log } from "@navi-ai/core/util/log"
import { TextAttributes } from "@opentui/core"
import { Global } from "../global"

// Initialize signals globally so IPC can update them
const [content, setContent] = createSignal("")
const [type, setType] = createSignal<"markdown" | "code" | "dashboard">("markdown")

// Async initialization wrapper
async function main() {
    try {
        await Global.init()
        await Log.init({
            dev: true,
            print: false, // Don't print to stdout to avoid messing up TUI
            level: "DEBUG"
        })

        const canvasId = process.argv[2] || "default"
        const log = Log.create({ service: `canvas-app-${canvasId}` })

        try {
            const ipc = new CanvasIPC(canvasId)
            ipc.createServer((msg) => {
                if (msg.type === "update") {
                    setContent(msg.content)
                    setType(msg.contentType)
                }
            })
            log.info("canvas ipc server started")
        } catch (e) {
            log.error("failed to start ipc server", { error: String(e) })
        }

        // Start Rendering
        render(() => <CanvasApp canvasId={canvasId} />, {
            targetFps: 60,
        })

    } catch (e) {
        console.error(e)
    }
}

function CanvasApp(props: { canvasId: string }) {
    const dimensions = useTerminalDimensions()

    return (
        <box width={dimensions().width} height={dimensions().height} padding={1}>
            <box border={["top", "bottom", "left", "right"]} borderColor="#fab283" padding={1} flexDirection="column">
                <box border={["bottom"]} borderColor="#555" marginBottom={1}>
                    <text attributes={TextAttributes.BOLD} fg="#fab283">Canvas: {props.canvasId} [{type().toUpperCase()}]</text>
                </box>
                <box flexGrow={1}>
                    <Switch>
                        <Match when={type() === "dashboard"}>
                            <Dashboard content={content()} />
                        </Match>
                        <Match when={type() === "markdown" || type() === "code"}>
                            <Document content={content()} type={type() as "markdown" | "code"} />
                        </Match>
                    </Switch>
                </box>
            </box>
        </box>
    )
}

function Dashboard(props: { content: string }) {
    return (
        <box flexDirection="column">
            <text>{props.content}</text>
        </box>
    )
}

function Document(props: { content: string, type: "markdown" | "code" }) {
    return (
        <box flexDirection="column">
            <text>{props.content}</text>
        </box>
    )
}

// Run
main()

