import { Bus } from "@/bus"
import { Account } from "@/account"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import { Session } from "@/session"
import type { SessionID } from "@/session/schema"
import { MessageV2 } from "@/session/message-v2"
import { JsonlStorage } from "@/storage/jsonl"
import { Log } from "@/util/log"
import type * as SDK from "@navi-ai/sdk/v2"

export namespace ShareNext {
  const log = Log.create({ service: "share-next" })

  type ApiEndpoints = {
    create: string
    sync: (shareId: string) => string
    remove: (shareId: string) => string
    data: (shareId: string) => string
  }

  function apiEndpoints(resource: string): ApiEndpoints {
    return {
      create: `/api/${resource}`,
      sync: (shareId) => `/api/${resource}/${shareId}/sync`,
      remove: (shareId) => `/api/${resource}/${shareId}`,
      data: (shareId) => `/api/${resource}/${shareId}/data`,
    }
  }

  const legacyApi = apiEndpoints("share")
  const consoleApi = apiEndpoints("shares")

  export async function url() {
    const req = await request()
    return req.baseUrl
  }

  export async function request(): Promise<{
    headers: Record<string, string>
    api: ApiEndpoints
    baseUrl: string
  }> {
    const headers: Record<string, string> = {}

    const active = await Account.active()
    if (!active?.active_org_id) {
      const baseUrl = await Config.get().then((x) => x.enterprise?.url ?? "https://opncd.ai")
      return { headers, api: legacyApi, baseUrl }
    }

    const token = await Account.token(active.id)
    if (!token) {
      throw new Error("No active account token available for sharing")
    }

    headers["authorization"] = `Bearer ${token}`
    headers["x-org-id"] = active.active_org_id
    return { headers, api: consoleApi, baseUrl: active.url }
  }

  const disabled = process.env["NAVI_DISABLE_SHARE"] === "true" || process.env["NAVI_DISABLE_SHARE"] === "1"

  export async function init() {
    if (disabled) return
    Bus.subscribe(Session.Event.Updated, async (evt) => {
      const session = await Session.get(evt.properties.sessionID)

      await sync(session.id, [
        {
          type: "session",
          data: session,
        },
      ])
    })
    Bus.subscribe(MessageV2.Event.Updated, async (evt) => {
      const info = evt.properties.info
      await sync(info.sessionID, [
        {
          type: "message",
          data: evt.properties.info as any,
        },
      ])
      if (info.role === "user") {
        await sync(info.sessionID, [
          {
            type: "model",
            data: [await Provider.getModel(info.model.providerID, info.model.modelID).then((m) => m as any)],
          },
        ])
      }
    })
    Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
      await sync(evt.properties.part.sessionID, [
        {
          type: "part",
          data: evt.properties.part,
        },
      ])
    })
    Bus.subscribe(Session.Event.Diff, async (evt) => {
      await sync(evt.properties.sessionID, [
        {
          type: "session_diff",
          data: evt.properties.diff,
        },
      ])
    })
  }

  export async function create(sessionID: SessionID) {
    if (disabled) return { id: "", url: "", secret: "" }
    log.info("creating share", { sessionID })
    const req = await request()
    const response = await fetch(`${req.baseUrl}${req.api.create}`, {
      method: "POST",
      headers: { ...req.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionID: sessionID }),
    })

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to create share (${response.status}): ${message || response.statusText}`)
    }

    const result = (await response.json()) as { id: string; url: string; secret: string }

    await JsonlStorage.writeItem("shares", sessionID, { id: result.id, secret: result.secret, url: result.url })
    fullSync(sessionID)
    return result
  }

  function get(sessionID: SessionID) {
    const row = JsonlStorage.readItemSync<any>("shares", sessionID)
    if (!row) return
    return { id: row.id, secret: row.secret, url: row.url }
  }

  type Data =
    | {
        type: "session"
        data: any
      }
    | {
        type: "message"
        data: any
      }
    | {
        type: "part"
        data: any
      }
    | {
        type: "session_diff"
        data: any[]
      }
    | {
        type: "model"
        data: any[]
      }

  function key(item: Data) {
    switch (item.type) {
      case "session":
        return "session"
      case "message":
        return `message/${item.data.id}`
      case "part":
        return `part/${item.data.messageID}/${item.data.id}`
      case "session_diff":
        return "session_diff"
      case "model":
        return "model"
    }
  }

  const queue = new Map<string, { timeout: NodeJS.Timeout; data: Map<string, Data> }>()
  async function sync(sessionID: SessionID, data: Data[]) {
    if (disabled) return
    const existing = queue.get(sessionID)
    if (existing) {
      for (const item of data) {
        existing.data.set(key(item), item)
      }
      return
    }

    const dataMap = new Map<string, Data>()
    for (const item of data) {
      dataMap.set(key(item), item)
    }

    const timeout = setTimeout(async () => {
      const queued = queue.get(sessionID)
      if (!queued) return
      queue.delete(sessionID)
      const share = get(sessionID)
      if (!share) return

      const req = await request()
      const response = await fetch(`${req.baseUrl}${req.api.sync(share.id)}`, {
        method: "POST",
        headers: { ...req.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: share.secret,
          data: Array.from(queued.data.values()),
        }),
      })

      if (!response.ok) {
        log.warn("failed to sync share", { sessionID, shareID: share.id, status: response.status })
      }
    }, 1000)
    queue.set(sessionID, { timeout, data: dataMap })
  }

  export async function remove(sessionID: SessionID) {
    if (disabled) return
    log.info("removing share", { sessionID })
    const share = get(sessionID)
    if (!share) return

    const req = await request()
    const response = await fetch(`${req.baseUrl}${req.api.remove(share.id)}`, {
      method: "DELETE",
      headers: { ...req.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: share.secret,
      }),
    })

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to remove share (${response.status}): ${message || response.statusText}`)
    }

    await JsonlStorage.deleteItem("shares", sessionID)
  }

  async function fullSync(sessionID: SessionID) {
    log.info("full sync", { sessionID })
    const session = await Session.get(sessionID)
    const diffs = await Session.diff(sessionID)
    const messages = await Array.fromAsync(MessageV2.stream(sessionID))
    const models = await Promise.all(
      Array.from(
        new Map(
          messages
            .filter((m) => m.info.role === "user")
            .map((m) => (m.info as SDK.UserMessage).model)
            .map((m) => [`${m.providerID}/${m.modelID}`, m] as const),
        ).values(),
      ).map((m) => Provider.getModel(ProviderID.make(m.providerID), ModelID.make(m.modelID)).then((item) => item)),
    )
    await sync(sessionID, [
      {
        type: "session",
        data: session,
      },
      ...messages.map((x) => ({
        type: "message" as const,
        data: x.info as any,
      })),
      ...messages.flatMap((x) => x.parts.map((y) => ({ type: "part" as const, data: y as any }))),
      {
        type: "session_diff",
        data: diffs,
      },
      {
        type: "model",
        data: models as any,
      },
    ])
  }
}

