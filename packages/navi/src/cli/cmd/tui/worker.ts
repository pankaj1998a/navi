import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { createNaviClient, type Event } from "@navi-ai/sdk/v2"
import type { BunWebSocketData } from "hono/bun"
import { P2P, P2PDiscovery } from "@/p2p"

await Log.init({
  print: process.env.NAVI_DEBUG === "1" || process.argv.includes("--print-logs"),
  dev: process.env.NAVI_DEBUG === "1" || Installation.isLocal(),
  level: (() => {
    if (process.env.NAVI_DEBUG === "1" || Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("event", event.payload)
})

let server: Bun.Server<BunWebSocketData> | undefined

const eventStream = {
  abort: undefined as AbortController | undefined,
}

const startEventStream = (directory: string) => {
  if (eventStream.abort) eventStream.abort.abort()
  const abort = new AbortController()
  eventStream.abort = abort
  const signal = abort.signal

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    return Server.App().fetch(request)
  }) as typeof globalThis.fetch

  const sdk = createNaviClient({
    baseUrl: "http://navi.internal",
    directory,
    fetch: fetchFn,
    signal,
  })

    ; (async () => {
      while (!signal.aborted) {
        const events = await Promise.resolve(
          sdk.event.subscribe(
            {},
            {
              signal,
            },
          ),
        ).catch(() => undefined)

        if (!events) {
          await Bun.sleep(250)
          continue
        }

        for await (const event of events.stream) {
          Rpc.emit("event", event as Event)
        }

        if (!signal.aborted) {
          await Bun.sleep(250)
        }
      }
    })().catch((error) => {
      Log.Default.error("event stream error", {
        error: error instanceof Error ? error.message : error,
      })
    })
}

startEventStream(process.cwd())

// Auto-start internal server for P2P (on random port)
let internalServer: Bun.Server<BunWebSocketData> | undefined

// Helper to get local network IP
function getLocalIP(): string {
  const nets = require("os").networkInterfaces()
  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue
    for (const netInfo of net) {
      // Skip internal and non-IPv4 addresses
      if (netInfo.internal || netInfo.family !== "IPv4") continue
      // Skip Docker bridge networks
      if (netInfo.address.startsWith("172.")) continue
      return netInfo.address
    }
  }
  return "127.0.0.1"
}

async function startInternalServer() {
  // Get local IP for P2P communication
  const localIP = getLocalIP()
  
  // Start internal server on random port, accessible from network
  internalServer = Server.listen({ port: 0, hostname: "0.0.0.0" })
  
  // Initialize P2P with the internal server port (using defaults)
  // The config will be read from navi.json if present
  P2P.init(internalServer.port!)
  
  // Update self info with the correct network IP
  const selfInfo = P2PDiscovery.getSelfInfo()
  if (selfInfo) {
    P2PDiscovery.updateSelfInfo({ hostname: localIP })
  }
  
  Log.Default.info("P2P auto-started", { 
    port: internalServer.port,
    hostname: localIP,
    peerId: P2PDiscovery.getSelfInfo()?.id 
  })
}

// Auto-start P2P on worker init
startInternalServer().catch((err) => {
  Log.Default.error("Failed to start P2P", { error: err })
})

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const request = new Request(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
    })
    const response = await Server.App().fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch(() => { })
      },
    })
  },
  async reload() {
    Config.global.reset()
    await Instance.disposeAll()
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    if (eventStream.abort) eventStream.abort.abort()
    P2P.stop()
    await Instance.disposeAll()
    if (internalServer) internalServer.stop(true)
    if (server) server.stop(true)
  },
}

Rpc.listen(rpc)
