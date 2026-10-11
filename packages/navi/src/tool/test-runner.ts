import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
import { spawnSync } from "node:child_process"
const DESCRIPTION = "Runs test suites (bun, vitest, jest, pytest, cargo, go) and provides structured failure diagnostics."

const log = Log.create({ service: "tool.test-runner" })

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Specific test file or directory to run (e.g. 'test/auth.test.ts', 'src/__tests__')",
  }),
  filter: Schema.optional(Schema.String).annotate({
    description: "Pattern or name substring to filter specific tests (e.g. 'login flow', 'handles timeout')",
  }),
  framework: Schema.optional(
    Schema.Literals(["auto", "bun", "vitest", "jest", "pytest", "cargo", "go", "npm"]).pipe(
      Schema.withDecodingDefault(Effect.succeed("auto" as const)),
    ),
  ).annotate({
    description: "Testing framework to use. Defaults to 'auto' detection.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Timeout in seconds (default: 60s)",
  }),
})

type TestFramework = "bun" | "vitest" | "jest" | "pytest" | "cargo" | "go" | "npm"

export function detectFramework(dir: string): TestFramework {
  if (fs.existsSync(path.join(dir, "bun.lock")) || fs.existsSync(path.join(dir, "bunfig.toml"))) {
    return "bun"
  }
  if (
    fs.existsSync(path.join(dir, "vitest.config.ts")) ||
    fs.existsSync(path.join(dir, "vitest.config.js")) ||
    fs.existsSync(path.join(dir, "vite.config.ts"))
  ) {
    return "vitest"
  }
  if (
    fs.existsSync(path.join(dir, "jest.config.js")) ||
    fs.existsSync(path.join(dir, "jest.config.ts")) ||
    fs.existsSync(path.join(dir, "jest.config.json"))
  ) {
    return "jest"
  }
  if (
    fs.existsSync(path.join(dir, "pytest.ini")) ||
    fs.existsSync(path.join(dir, "conftest.py")) ||
    fs.existsSync(path.join(dir, "setup.cfg"))
  ) {
    return "pytest"
  }
  if (fs.existsSync(path.join(dir, "Cargo.toml"))) {
    return "cargo"
  }
  if (fs.existsSync(path.join(dir, "go.mod"))) {
    return "go"
  }
  return "npm"
}

export function buildCommand(
  framework: TestFramework,
  testPath?: string,
  filter?: string,
): { cmd: string[]; display: string } {
  let cmd: string[] = []

  switch (framework) {
    case "bun":
      cmd = ["bun", "test"]
      if (testPath) cmd.push(testPath)
      if (filter) cmd.push("--test-name-pattern", filter)
      break

    case "vitest":
      cmd = ["npx", "vitest", "run"]
      if (testPath) cmd.push(testPath)
      if (filter) cmd.push("-t", filter)
      break

    case "jest":
      cmd = ["npx", "jest"]
      if (testPath) cmd.push(testPath)
      if (filter) cmd.push("-t", filter)
      break

    case "pytest":
      cmd = ["pytest"]
      if (testPath) cmd.push(testPath)
      if (filter) cmd.push("-k", filter)
      break

    case "cargo":
      cmd = ["cargo", "test"]
      if (filter) cmd.push(filter)
      break

    case "go":
      cmd = ["go", "test"]
      cmd.push(testPath ? testPath : "./...")
      if (filter) cmd.push("-run", filter)
      break

    case "npm":
    default:
      cmd = ["npm", "test"]
      if (testPath) cmd.push("--", testPath)
      break
  }

  return { cmd, display: cmd.join(" ") }
}

export const TestRunnerTool = Tool.define(
  "test_runner",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const fw = params.framework === "auto" || !params.framework
            ? detectFramework(instance.directory)
            : params.framework

          const { cmd, display } = buildCommand(fw, params.path, params.filter)

          yield* ctx.ask({
            permission: "test_runner",
            patterns: [display],
            always: ["*"],
            metadata: {
              framework: fw,
              command: display,
              path: params.path,
            },
          })

          log.info("running test suite", { command: display })

          const bin = cmd[0]!
          const args = cmd.slice(1)

          const runResult = (() => {
            try {
              const res = spawnSync(bin, args, {
                cwd: instance.directory,
                env: process.env,
                encoding: "utf-8",
                timeout: (params.timeout ?? 60) * 1000,
              })
              return {
                stdout: (res.stdout || "").trim(),
                stderr: (res.stderr || "").trim(),
                exitCode: res.status ?? (res.error ? 1 : 0),
              }
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err)
              return { stdout: "", stderr: message, exitCode: 1 }
            }
          })()

          const combined = (runResult.stdout + "\n" + runResult.stderr).trim()
          const passed = runResult.exitCode === 0

          // Structured failure diagnostics
          const failedFiles: string[] = []
          const failedTests: string[] = []
          const isTimeout = /timed?\s*out|ETIMEDOUT|timeout\s*exceeded/i.test(combined)

          for (const line of combined.split("\n")) {
            const fileMatch = line.match(/(?:FAIL|FAILED)\s+([^\s:]+\.[a-zA-Z0-9]+)/i)
            if (fileMatch && !failedFiles.includes(fileMatch[1]!)) {
              failedFiles.push(fileMatch[1]!)
            }
            const testMatch = line.match(/(?:✕|FAIL|FAILED)\s+(?:(?:test\s+)?)([^(\n]+?)(?:\s+\(\d+ms\))?$/)
            if (testMatch && testMatch[1] && !failedTests.includes(testMatch[1].trim())) {
              failedTests.push(testMatch[1].trim())
            }
          }

          const statusIcon = passed ? "✅" : "❌"
          const statusText = passed ? "PASSED" : "FAILED"

          const summaryParts = [
            `### ${statusIcon} Test Run ${statusText} (\`${fw}\`)`,
            `- **Command**: \`${display}\``,
            `- **Exit Code**: ${runResult.exitCode}`,
          ]

          if (!passed) {
            summaryParts.push(``)
            summaryParts.push(`#### 📊 Test Failure Diagnostic Matrix`)
            if (failedFiles.length > 0) {
              summaryParts.push(`- **Failing Files (${failedFiles.length})**: ${failedFiles.map((f) => `\`${f}\``).join(", ")}`)
            }
            if (failedTests.length > 0) {
              summaryParts.push(`- **Failing Tests (${failedTests.length})**:`)
              for (const t of failedTests.slice(0, 10)) {
                summaryParts.push(`  - ❌ \`${t}\``)
              }
              if (failedTests.length > 10) {
                summaryParts.push(`  - ... and ${failedTests.length - 10} more`)
              }
            }
            if (isTimeout) {
              summaryParts.push(`- ⚠️ **Timeout Detected**: Execution exceeded test budget or stalled. Check for unmocked async timers or deadlocks.`)
            }
          }

          summaryParts.push(``)
          summaryParts.push("```text")
          summaryParts.push(combined.slice(0, 10000))
          if (combined.length > 10000) summaryParts.push("\n... (output truncated)")
          summaryParts.push("```")

          if (!passed) {
            summaryParts.push("\n> [!IMPORTANT]\n> Tests failed. Focus repairs on the failing files and tests identified in the diagnostic matrix above.")
          }

          const outputSummary = summaryParts.join("\n")

          return {
            title: `Tests ${statusText} (${fw})`,
            output: outputSummary,
            metadata: {
              passed,
              framework: fw,
              command: display,
              exitCode: runResult.exitCode,
              failedFiles,
              failedTests,
              isTimeout,
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)
