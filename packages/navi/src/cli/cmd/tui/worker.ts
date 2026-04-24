import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import type { Event } from "@navi-ai/sdk/v2"
import { Flag } from "@/flag/flag"
import { setTimeout as sleep } from "node:timers/promises"
import { writeHeapSnapshot } from "node:v8"
import { Registry, AgentDefinition } from "@/agent/registry"
import { ToolRegistry } from "@/tool/registry"
import { AgentRunner } from "@/agent/agent-runner"
import { MCP } from "@/mcp"
import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { Network } from "@/server/schema"

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

process.on("unhandledRejection", (e: any) => {
  Log.Default.error("rejection", {
    message: e?.message || String(e),
    stack: e?.stack,
    error: e
  })
})

process.on("uncaughtException", (e: any) => {
  Log.Default.error("exception", {
    message: e?.message || String(e),
    stack: e?.stack,
    error: e
  })
})

self.addEventListener("error", (e) => {
  Log.Default.error("worker process error", {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    error: e.error
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

const eventStream = {
  abort: undefined as AbortController | undefined,
}

const startEventStream = (input: { directory: string; workspaceID?: string }) => {
  if (eventStream.abort) eventStream.abort.abort()
  const abort = new AbortController()
  eventStream.abort = abort
  const signal = abort.signal

  ;(async () => {
    while (!signal.aborted) {
      const shouldReconnect = await Instance.provide({
        directory: input.directory,
        init: InstanceBootstrap,
        fn: () =>
          new Promise<boolean>((resolve) => {
            Rpc.emit("event", {
              type: "server.connected",
              properties: {},
            } satisfies Event)

            let settled = false
            const settle = (value: boolean) => {
              if (settled) return
              settled = true
              signal.removeEventListener("abort", onAbort)
              unsub()
              resolve(value)
            }

            const unsub = Bus.subscribeAll((event) => {
              Rpc.emit("event", event as Event)
              if (event.type === Bus.InstanceDisposed.type) {
                settle(true)
              }
            })

            const onAbort = () => {
              settle(false)
            }

            signal.addEventListener("abort", onAbort, { once: true })
          }),
      }).catch((error) => {
        Log.Default.error("event stream subscribe error", {
          error: error instanceof Error ? error.message : error,
        })
        return false
      })

      if (!shouldReconnect || signal.aborted) {
        break
      }

      if (!signal.aborted) {
        await sleep(250)
      }
    }
  })().catch((error) => {
    Log.Default.error("event stream error", {
      error: error instanceof Error ? error.message : error,
    })
  })
}

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = getAuthorizationHeader()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    await Config.invalidate(true)
  },
  async setWorkspace(input: { workspaceID?: string }) {
    startEventStream({ directory: process.cwd(), workspaceID: input.workspaceID })
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    if (eventStream.abort) eventStream.abort.abort()
    await Instance.disposeAll()
    if (server) await server.stop(true)
  },
  "project.upsert": async (input: Project.UpdateInput) => {
    return Project.update(input)
  },
  "project.get": async (id: ProjectID) => {
    return Project.get(id)
  },
  "project.list": async () => {
    return Project.list()
  },
  "project.sandboxes": async (id: ProjectID) => {
    return Project.sandboxes(id)
  },
  "project.addSandbox": async (input: { id: ProjectID; directory: string }) => {
    return Project.addSandbox(input.id, input.directory)
  },
  "project.removeSandbox": async (input: { id: ProjectID; directory: string }) => {
    return Project.removeSandbox(input.id, input.directory)
  },
  "instance.provide": async (input: { directory: string; network?: Network.Config }) => {
    return Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {},
    })
  },
  "config.get": async (id: ProjectID) => {
    return Config.get(id)
  },
  "tools.list": async () => {
    return ToolRegistry.list()
  },
  "tools.get": async (id: string) => {
    return ToolRegistry.get(id)
  },
  "agents.list": async () => {
    return Registry.list()
  },
  "agents.get": async (id: string) => {
    return Registry.get(id)
  },
}

Rpc.listen(rpc)
startEventStream({ directory: process.cwd() })

function getAuthorizationHeader(): string | undefined {
  const password = Flag.NAVI_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.NAVI_SERVER_USERNAME ?? "Navi"
  return `Basic ${btoa(`${username}:${password}`)}`
}
