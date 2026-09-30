import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./voice.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["status", "transcribe", "speak", "enable", "disable"]).annotate({
    description: "Voice action: status, transcribe (STT), speak (TTS), enable/disable voice mode",
  }),
  text: Schema.optional(Schema.String).annotate({
    description: "Text to synthesize for action 'speak'",
  }),
  audio: Schema.optional(Schema.String).annotate({
    description: "Base64 audio or file path for action 'transcribe' (stub)",
  }),
  language: Schema.optional(Schema.String).annotate({
    description: "BCP-47 language code (e.g. en-US) for STT/TTS",
  }),
})

export const VoiceTool = Tool.define(
  "voice",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "voice",
            patterns: [params.action],
            always: ["status"],
            metadata: { action: params.action },
          })

          switch (params.action) {
            case "status":
              return {
                title: "Voice status",
                output: [
                  "Voice Mode: stub (disabled)",
                  "Backends (full impl): cpal (native), SoX rec, ALSA arecord",
                  "STT: voiceStreamSTT.ts streaming, TTS: native synthesis",
                  "Keyterms: voiceKeyterms.ts hotword detection",
                  "Enable with action 'enable' (stub — no mic access).",
                ].join("\n"),
                metadata: { enabled: false, backend: "stub" } as Record<string, unknown>,
              }
            case "enable":
              return {
                title: "Voice enabled (stub)",
                output: "Voice mode enabled (stub). In full implementation this would initialize cpal native audio capture and stream STT.",
                metadata: { enabled: true } as Record<string, unknown>,
              }
            case "disable":
              return {
                title: "Voice disabled",
                output: "Voice mode disabled.",
                metadata: { enabled: false } as Record<string, unknown>,
              }
            case "transcribe": {
              const placeholder = params.audio
                ? `Transcribed (stub) from ${params.audio.slice(0, 32)}...`
                : "No audio provided — stub transcript: 'hello navi, transcribe this placeholder'"
              return {
                title: "STT transcript (stub)",
                output: `${placeholder}\n\nLanguage: ${params.language ?? "en-US"}\nNote: real STT would use streaming audio-capture-napi @ 16kHz.`,
                metadata: { transcript: placeholder } as Record<string, unknown>,
              }
            }
            case "speak": {
              if (!params.text) throw new Error("Parameter 'text' is required for action 'speak'")
              return {
                title: "TTS synthesized (stub)",
                output: `Synthesized (stub) text: "${params.text.slice(0, 200)}"\nLanguage: ${params.language ?? "en-US"}\nAudio: base64 placeholder (no real synthesis)\nFull impl: native TTS via platform speech engine.`,
                metadata: { text: params.text, audio: "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAA==" } as Record<
                  string,
                  unknown
                >,
              }
            }
            default:
              throw new Error(`Unknown voice action: ${params.action}`)
          }
        }).pipe(Effect.orDie),
    }
  }),
)
