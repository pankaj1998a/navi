import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./vcr.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["record", "replay", "list", "stop"]).annotate({
    description: "VCR action: record, replay, list fixtures, or stop recording",
  }),
  fixture: Schema.optional(Schema.String).annotate({
    description: "Fixture name or path (e.g. session-123.json) for record/replay",
  }),
  sessionId: Schema.optional(Schema.String).annotate({
    description: "Session ID to record/replay",
  }),
})

function vcrDir(worktree: string): string {
  return `${worktree}/.navi/vcr`
}

export const VcrTool = Tool.define(
  "vcr",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "vcr",
            patterns: [params.action, params.fixture ?? "*"],
            always: ["list", "stop"],
            metadata: { action: params.action, fixture: params.fixture },
          })

          switch (params.action) {
            case "record":
              return {
                title: `VCR record: ${params.fixture ?? "session"}`,
                output: [
                  `Recording started (stub) -> ${vcrDir("<worktree>")}/${params.fixture ?? `${ctx.sessionID}.json`}`,
                  `Session: ${params.sessionId ?? ctx.sessionID}`,
                  "Full impl: withFixture<T> + shouldUseVCR() gating, request hashing, token-count VCR (withTokenCountVCR).",
                  "This stub does not intercept LLM traffic.",
                ].join("\n"),
                metadata: { recording: true, fixture: params.fixture ?? ctx.sessionID } as Record<string, unknown>,
              }
            case "replay": {
              if (!params.fixture) throw new Error("Parameter 'fixture' is required for action 'replay'")
              return {
                title: `VCR replay: ${params.fixture}`,
                output: [
                  `Replaying fixture (stub): ${vcrDir("<worktree>")}/${params.fixture}`,
                  "Deterministic replay would inject cached LLM + tool responses via withFixture().",
                  "Add --with-vcr or FORCE_VCR=1 in full impl.",
                ].join("\n"),
                metadata: { replaying: true, fixture: params.fixture } as Record<string, unknown>,
              }
            }
            case "list":
              return {
                title: "VCR fixtures (stub)",
                output: [
                  `Fixtures dir (stub): ${vcrDir("<worktree>")}`,
                  "- (no fixtures — stub lists placeholder)",
                  "  e.g. 2026-04-04-session-abc.json",
                  "  e.g. token-count-fixture.json",
                ].join("\n"),
                metadata: { count: 0 } as Record<string, unknown>,
              }
            case "stop":
              return {
                title: "VCR stopped",
                output: "Recording stopped (stub). Fixture flushed to disk in full impl.",
                metadata: { recording: false } as Record<string, unknown>,
              }
            default:
              throw new Error(`Unknown vcr action: ${params.action}`)
          }
        }).pipe(Effect.orDie),
    }
  }),
)
