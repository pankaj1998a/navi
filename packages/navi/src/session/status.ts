import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import z from "zod"

export namespace SessionStatus {
  const Common = z.object({
    permissionMode: z.enum(["safe", "ask", "allow-all"]).optional(),
    thinkingLevel: z.enum(["off", "think", "max", "adaptive"]).optional(),
    phase: z
      .enum([
        "idle",
        "running",
        "planning",
        "delegating",
        "reviewing",
        "qa",
        "researching",
        "waiting",
        "blocked",
        "retrying",
        "complete",
      ])
      .optional(),
    blockedReason: z.string().optional(),
    nextAction: z.string().optional(),
    activeAgents: z.array(z.string()).optional(),
    activeTools: z.array(z.string()).optional(),
    burnRateUsd: z.number().nonnegative().optional(),
    taskClass: z.string().optional(),
  })

  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }).extend(Common.shape),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }).extend(Common.shape),
      z.object({
        type: z.literal("busy"),
      }).extend(Common.shape),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: z.string(),
        status: Info,
      }),
    ),
    // deprecated
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  const state = Instance.state(() => {
    const data: Record<string, Info> = {}
    return data
  })

  export function get(sessionID: string) {
    return (
      state()[sessionID] ?? {
        type: "idle",
        phase: "idle",
      }
    )
  }

  export function list() {
    return state()
  }

  export function set(sessionID: string, status: Info) {
    Bus.publish(Event.Status, {
      sessionID,
      status,
    })
    if (status.type === "idle") {
      // deprecated
      Bus.publish(Event.Idle, {
        sessionID,
      })
      delete state()[sessionID]
      return
    }
    state()[sessionID] = status
  }
}
