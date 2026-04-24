import z from "zod"
import { setTimeout as sleep } from "node:timers/promises"
import { fn } from "@/util/fn"
import { JsonlStorage } from "@/storage/jsonl"
import { Project } from "@/project/project"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Log } from "@/util/log"
import { ProjectID } from "@/project/schema"
import { getAdaptor } from "./adaptors"
import { WorkspaceInfo } from "./types"
import { WorkspaceID } from "./schema"
import { parseSSE } from "./sse"

export namespace Workspace {
  export const Event = {
    Ready: BusEvent.define(
      "workspace.ready",
      z.object({
        name: z.string(),
      }),
    ),
    Failed: BusEvent.define(
      "workspace.failed",
      z.object({
        message: z.string(),
      }),
    ),
  }

  export const Info = WorkspaceInfo.meta({
    ref: "Workspace",
  })
  export type Info = z.infer<typeof Info>

  const CreateInput = z.object({
    id: WorkspaceID.zod.optional(),
    type: Info.shape.type,
    branch: Info.shape.branch,
    projectID: ProjectID.zod,
    extra: Info.shape.extra,
  })

  export const create = fn(CreateInput, async (input) => {
    const id = WorkspaceID.ascending(input.id)
    const adaptor = await getAdaptor(input.type)

    const config = await adaptor.configure({ ...input, id, name: null, directory: null })

    const info: Info = {
      id,
      type: config.type,
      branch: config.branch ?? null,
      name: config.name ?? null,
      directory: config.directory ?? null,
      extra: config.extra ?? null,
      projectID: input.projectID,
    }

    await JsonlStorage.writeItem("workspaces", info.id, info)

    await adaptor.create(config)
    return info
  })

  export function list(project: Project.Info) {
    const all = JsonlStorage.listItemsSync<Info>("workspaces")
    return all
      .filter((w: Info) => w.projectID === project.id)
      .sort((a: Info, b: Info) => a.id.localeCompare(b.id))
  }

  export const get = fn(WorkspaceID.zod, async (id) => {
    return (await JsonlStorage.readItem<Info>("workspaces", id)) ?? undefined
  })

  export const remove = fn(WorkspaceID.zod, async (id) => {
    const info = await JsonlStorage.readItem<Info>("workspaces", id)
    if (info) {
      const adaptor = await getAdaptor(info.type)
      await adaptor.remove(info)
      await JsonlStorage.deleteItem("workspaces", id)
      return info
    }
  })
  const log = Log.create({ service: "workspace-sync" })

  async function workspaceEventLoop(space: Info, stop: AbortSignal) {
    while (!stop.aborted) {
      const adaptor = await getAdaptor(space.type)
      const res = await adaptor.fetch(space, "/event", { method: "GET", signal: stop }).catch(() => undefined)
      if (!res || !res.ok || !res.body) {
        await sleep(1000)
        continue
      }
      await parseSSE(res.body, stop, (event) => {
        GlobalBus.emit("event", {
          directory: space.id,
          payload: event,
        })
      })
      // Wait 250ms and retry if SSE connection fails
      await sleep(250)
    }
  }

  export function startSyncing(project: Project.Info) {
    const stop = new AbortController()
    const spaces = list(project).filter((space) => space.type !== "worktree")

    spaces.forEach((space) => {
      void workspaceEventLoop(space, stop.signal).catch((error) => {
        log.warn("workspace sync listener failed", {
          workspaceID: space.id,
          error,
        })
      })
    })

    return {
      async stop() {
        stop.abort()
      },
    }
  }
}
