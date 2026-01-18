import { render, useTerminalDimensions } from "@opentui/solid"
import { createSignal, onMount, Show, Switch, Match } from "solid-js"
import { CanvasIPC, CanvasMessage } from "./ipc"
import { Log } from "../util/log"
import { TextAttributes } from "@opentui/core"

function CanvasApp(props: { canvasId: string }) {
    const dimensions = useTerminalDimensions()
    const [content, setContent] = createSignal("")
    const [type, setType] = createSignal<"markdown" | "code" | "dashboard">("markdown")
    const log = Log.create({ service: `canvas-app-${props.canvasId}` })

    onMount(async () => {
        try {
            const socket = await CanvasIPC.connect(props.canvasId, (msg) => {
                if (msg.type === "update") {
                    setContent(msg.content)
                    setType(msg.contentType)
                }
            })

            CanvasIPC.send(socket, { type: "ready" })
        } catch (e) {
            log.error("failed to connect to ipc server", { error: String(e) })
        }
    })

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

const canvasId = process.argv[2] || "default"
render(() => <CanvasApp canvasId={canvasId} />, {
    targetFps: 60,
})
