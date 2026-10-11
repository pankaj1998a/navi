import { Effect, Schema, Stream } from "effect"
import * as Tool from "./tool"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { ENGINE_SPECS, detectEngines } from "@/reverse/providers"
const DESCRIPTION = "Runs environment diagnostic for reverse engineering tools and decompilers."

export const Parameters = Schema.Struct({})

export const ReverseDoctorTool = Tool.define(
  "reverse_doctor",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const probe = Effect.fnUntraced(function* (binary: string, args: readonly string[]) {
      const proc = ChildProcess.make(binary, [...args], { extendEnv: true })
      const handle = yield* spawner.spawn(proc)
      const out = yield* Stream.mkString(Stream.decodeText(handle.stdout))
      yield* handle.exitCode
      const first = out.split("\n")[0]?.trim() ?? ""
      return first.slice(0, 120)
    }, Effect.scoped)
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (_params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const detected = detectEngines()
          const rows: string[] = []
          for (const spec of ENGINE_SPECS) {
            const found = detected.find((d) => d.id === spec.id)
            if (!found?.present || !found.path) {
              rows.push(`- ❌ **${spec.label}** — missing. ${spec.installHint}`)
              continue
            }
            let version = ""
            if (spec.versionArgs.length > 0) {
              const probed = yield* probe(found.path, spec.versionArgs).pipe(
                Effect.catch(() => Effect.succeed("")),
              )
              if (probed) version = ` (${probed})`
            }
            rows.push(`- ✅ **${spec.label}**${version} — \`${found.path}\``)
          }
          const lines = [
            "# Reverse: engine doctor",
            "",
            "Inbuilt static analysis (JS, .NET, APK, EVM, firmware, ELF/Mach-O/PE, plist, HAR) needs no engine.",
            "Deep providers below are bring-your-own and never auto-installed.",
            "",
            ...rows,
            "",
            "Bridges vendored under `src/reverse/bridges/`. Set `GHIDRA_INSTALL_DIR` for Ghidra, `REA_PWNTOOLS_PYTHON` for pwntools.",
          ].join("\n")
          return {
            title: "Reverse doctor",
            output: lines,
            metadata: { engines: detected.filter((d) => d.present).length } as Record<string, unknown>,
          }
        }),
    }
  }),
)
