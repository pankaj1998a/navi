import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import type { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { PtcEvalTool } from "../../src/tool/ptc-eval"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const runtime = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

describe("PtcEvalTool permission gating", () => {
  test("calls ctx.ask with ptc_eval permission before executing code", async () => {
    let askCalledWith: any = null

    const ctx: Tool.Context = {
      sessionID: SessionID.descending(),
      messageID: MessageID.ascending(),
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata() {
        return Effect.void
      },
      ask(params) {
        askCalledWith = params
        return Effect.void
      },
    }

    const toolDef = await runtime.runPromise(PtcEvalTool)
    const tool = await Effect.runPromise(toolDef.init())
    const execute = tool.execute as (args: any, ctx: Tool.Context) => Effect.Effect<any, any>

    await using dir = await tmpdir()
    await provideTestInstance({
      directory: dir.path,
      fn: async () => {
        const result = await Effect.runPromise(
          execute(
            {
              code: 'return "hello from ptc"',
            },
            ctx,
          ),
        )

        expect(askCalledWith).not.toBeNull()
        expect(askCalledWith.permission).toBe("ptc_eval")
        expect(askCalledWith.patterns).toEqual(["*"])
        expect(askCalledWith.metadata.code_preview).toBe('return "hello from ptc"')
        expect(result.output).toContain("hello from ptc")
      },
    })
  })

  test("rejects execution if ctx.ask fails (permission denied)", async () => {
    const ctx: Tool.Context = {
      sessionID: SessionID.descending(),
      messageID: MessageID.ascending(),
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata() {
        return Effect.void
      },
      ask() {
        return Effect.fail(new Error("Permission denied for ptc_eval")) as unknown as Effect.Effect<void>
      },
    }

    const toolDef = await runtime.runPromise(PtcEvalTool)
    const tool = await Effect.runPromise(toolDef.init())
    const execute = tool.execute as (args: any, ctx: Tool.Context) => Effect.Effect<any, any>

    let errorThrown: any = null
    try {
      await Effect.runPromise(
        execute(
          {
            code: 'return "should never run"',
          },
          ctx,
        ),
      )
    } catch (err) {
      errorThrown = err
    }

    expect(errorThrown).not.toBeNull()
    expect(String(errorThrown)).toContain("Permission denied for ptc_eval")
  })
})

