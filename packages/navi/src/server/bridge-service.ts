import { Log } from "../util/log"
import { GlobalBus } from "@/bus/global"

export namespace BridgeService {
  const log = Log.create({ service: "bridge" })

  export interface Connection {
    id: string
    ws: any
    connectedAt: number
    lastSeen: number
    ua?: string
    ip?: string
  }

  const connections = new Map<string, Connection>()
  const pendingRequests = new Map<string, (result: any) => void>()

  export function register(id: string, ws: any, metadata: { ua?: string; ip?: string } = {}) {
    log.info("registering connection", { id, ...metadata })
    connections.set(id, {
      id,
      ws,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      ...metadata,
    })

    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: "bridge.connected",
        properties: { id, ...metadata },
      } as any,
    })
  }

  export function unregister(id: string) {
    const conn = connections.get(id)
    if (conn) {
      connections.delete(id)
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: "bridge.disconnected",
          properties: { id },
        } as any,
      })
    }
  }

  export function getConnections() {
    return Array.from(connections.values()).map(c => ({
      id: c.id,
      connectedAt: c.connectedAt,
      lastSeen: c.lastSeen,
      ua: c.ua,
      ip: c.ip,
    }))
  }

  export function disconnectAll() {
    for (const [id, conn] of Array.from(connections.entries())) {
      try {
        conn.ws.close()
      } catch (e) {
        log.error("error closing connection", { id, error: e })
      }
    }
    connections.clear()
  }

  export async function request(id: string, payload: any): Promise<any> {
    const conn = connections.get(id)
    if (!conn) throw new Error(`Connection ${id} not found`)

    const requestId = Math.random().toString(36).slice(2)
    const message = JSON.stringify({ ...payload, requestId })
    
    return new Promise((resolve) => {
        pendingRequests.set(requestId, resolve)
        conn.ws.send(message)
    })
  }

  export function handleMessage(id: string, data: any) {
    const conn = connections.get(id)
    if (conn) {
      conn.lastSeen = Date.now()
    }

    if (data.requestId && pendingRequests.has(data.requestId)) {
        const resolve = pendingRequests.get(data.requestId)!
        pendingRequests.delete(data.requestId)
        resolve(data.payload)
    }
  }
}



