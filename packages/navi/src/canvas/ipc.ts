import net from "net"
import fs from "fs"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"

export type CanvasMessage =
    | { type: "update"; content: string; contentType: "markdown" | "code" | "dashboard" }
    | { type: "getSelection" }
    | { type: "getContent" }
    | { type: "ready" }
    | { type: "error"; message: string }

export class CanvasIPC {
    private static log = Log.create({ service: "canvas-ipc" })
    private socketPath: string

    constructor(private canvasId: string) {
        if (process.platform === "win32") {
            this.socketPath = `\\\\.\\pipe\\navi-canvas-${canvasId}`
        } else {
            this.socketPath = path.join(Global.Path.state, `canvas-${canvasId}.sock`)
        }
    }

    createServer(onMessage: (msg: CanvasMessage, socket: net.Socket) => void) {
        if (fs.existsSync(this.socketPath)) {
            fs.unlinkSync(this.socketPath)
        }

        const server = net.createServer((socket) => {
            CanvasIPC.log.debug("canvas client connected", { id: this.canvasId })

            socket.on("data", (data) => {
                try {
                    const msg = JSON.parse(data.toString()) as CanvasMessage
                    onMessage(msg, socket)
                } catch (e) {
                    CanvasIPC.log.error("failed to parse canvas message", { error: String(e) })
                }
            })
        })

        server.listen(this.socketPath, () => {
            CanvasIPC.log.debug("canvas ipc server listening", { path: this.socketPath })
        })

        return server
    }

    static connect(canvasId: string, onMessage: (msg: CanvasMessage) => void): Promise<net.Socket> {
        let socketPath: string
        if (process.platform === "win32") {
            socketPath = `\\\\.\\pipe\\navi-canvas-${canvasId}`
        } else {
            socketPath = path.join(Global.Path.state, `canvas-${canvasId}.sock`)
        }
        return new Promise((resolve, reject) => {
            const socket = net.createConnection(socketPath, () => {
                this.log.debug("connected to canvas ipc server", { id: canvasId })
                resolve(socket)
            })

            socket.on("data", (data) => {
                try {
                    const msg = JSON.parse(data.toString()) as CanvasMessage
                    onMessage(msg)
                } catch (e) {
                    this.log.error("failed to parse canvas message", { error: String(e) })
                }
            })

            socket.on("error", reject)
        })
    }

    static send(socket: net.Socket, msg: CanvasMessage) {
        socket.write(JSON.stringify(msg))
    }
}
