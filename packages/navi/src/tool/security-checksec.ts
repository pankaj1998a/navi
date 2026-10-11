import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import path from "node:path"
import { checksecBinary } from "@/security/checksec"

const DESCRIPTION =
  "Inspects compiled executables and shared libraries (ELF, PE, Mach-O) for exploit mitigations: ASLR/PIE, NX/DEP, Stack Canaries, RELRO, and Control Flow Guard."

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "Path to executable binary or shared library to audit",
  }),
})

export const SecurityChecksecTool = Tool.define(
  "security_checksec",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const target = path.isAbsolute(params.path)
            ? params.path
            : path.resolve(instance.directory, params.path)

          try {
            const audit = checksecBinary(target)
            const fileName = path.basename(target)

            const badge = (enabled: boolean, label: string) =>
              enabled ? `✅ **${label}**: Enabled` : `❌ **${label}**: Disabled`

            const lines: string[] = [
              `# 🛡️ Binary Security Audit (Checksec): \`${fileName}\``,
              `* Target File: \`${target}\``,
              `* Format: \`${audit.format.toUpperCase()}\` (${audit.architecture}, ${audit.bits}-bit)`,
              `* Security Hardening Score: **${audit.securityScore}/100**`,
              "",
              "## Exploit Mitigations",
              `- ${badge(audit.nx, "NX / DEP (Data Execution Prevention)")}`,
              `- ${badge(audit.pie, "ASLR / PIE (Address Space Randomization)")}`,
              `- ${badge(audit.canary, "Stack Canaries (/GS Cookies)")}`,
            ]

            if (audit.relro !== undefined) {
              const relroStatus =
                audit.relro === "full"
                  ? "✅ **RELRO**: Full RELRO (GOT Read-Only)"
                  : audit.relro === "partial"
                    ? "🟡 **RELRO**: Partial RELRO"
                    : "❌ **RELRO**: None"
              lines.push(`- ${relroStatus}`)
            }

            if (audit.controlFlowGuard !== undefined) {
              lines.push(`- ${badge(audit.controlFlowGuard, "Control Flow Guard (CFG)")}`)
            }

            if (audit.signed !== undefined) {
              lines.push(`- ${badge(audit.signed, "Code / Authenticode Signature")}`)
            }

            lines.push("", "## Technical Findings & Recommendations")
            for (const n of audit.notes) {
              lines.push(`- ${n}`)
            }

            return {
              title: `Checksec: ${fileName}`,
              output: lines.join("\n"),
              metadata: {
                format: audit.format,
                score: audit.securityScore,
                nx: audit.nx,
                pie: audit.pie,
                canary: audit.canary,
              } as Record<string, unknown>,
            }
          } catch (err) {
            return {
              title: "Checksec Failed",
              output: `❌ Checksec audit failed: ${String(err)}`,
              metadata: { error: String(err) } as Record<string, unknown>,
            }
          }
        }),
    }
  }),
)
