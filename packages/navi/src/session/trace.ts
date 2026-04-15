import fs from "fs/promises"
import path from "path"
import { Config } from "@/config/config"
import { Global } from "@/global"

export namespace SessionTrace {
  export type Event =
    | {
      type: "turn.start"
      step: number
      agent: string
      agentVersion?: string
      promptHash?: string
      taskClass?: string
      requestedModel: string
      routedModel: string
      reasons: string[]
      policy: Record<string, unknown>
    }
    | {
      type: "turn.finish"
      step: number
      agent: string
      agentVersion?: string
      promptHash?: string
      taskClass?: string
      finish?: string
      toolCalls: number
      questionCount: number
      cost: number
      error?: string
      responseKind?: string
      responseConfidence?: number
      responseSources?: string[]
      responseNextStep?: string
      responseBlockedReason?: string
      responseHandoff?: {
        summary: string
        nextAgent?: string
        openQuestions?: string[]
        files?: string[]
        notes?: string
      }
    }

  async function filepath(sessionID: string) {
    const config = await Config.get()
    const dir = config.experimental?.sessionTracing?.directory
      ? path.resolve(config.experimental.sessionTracing.directory)
      : path.join(Global.Path.state, "trace")
    await fs.mkdir(dir, { recursive: true })
    return path.join(dir, `${sessionID}.jsonl`)
  }

  export async function record(sessionID: string, event: Event) {
    const config = await Config.get()
    if (config.experimental?.sessionTracing?.enabled === false) return
    const file = await filepath(sessionID)
    await fs.appendFile(
      file,
      JSON.stringify({
        time: Date.now(),
        sessionID,
        ...event,
      }) + "\n",
    )
  }
}



