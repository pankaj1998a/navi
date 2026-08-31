import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
import DESCRIPTION from "./test-runner.txt"

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

          const runResult = yield* Effect.promise(async () => {
            try {
              const proc = Bun.spawn(cmd, {
                cwd: instance.directory,
                env: process.env,
                stdout: "pipe",
                stderr: "pipe",
              })

              const [stdout, stderr] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
              ])
              const exitCode = await proc.exited

              return { stdout, stderr, exitCode }
            } catch (err: any) {
              return { stdout: "", stderr: err?.message ?? String(err), exitCode: 1 }
            }
          })

          const combined = (runResult.stdout + "\n" + runResult.stderr).trim()
          const passed = runResult.exitCode === 0

          let statusIcon = passed ? "✅" : "❌"
          let statusText = passed ? "PASSED" : "FAILED"

          let outputSummary = [
            `### ${statusIcon} Test Run ${statusText} (\`${fw}\`)`,
            `- **Command**: \`${display}\``,
            `- **Exit Code**: ${runResult.exitCode}`,
            "",
            "```text",
            combined.slice(0, 10000),
            combined.length > 10000 ? "\n... (output truncated)" : "",
            "```",
          ].join("\n")

          if (!passed) {
            outputSummary += "\n\n> [!IMPORTANT]\n> Tests failed. Please inspect the errors and stack traces above to self-correct the implementation."
          }

          return {
            title: `Tests ${statusText} (${fw})`,
            output: outputSummary,
            metadata: {
              passed,
              framework: fw,
              command: display,
              exitCode: runResult.exitCode,
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)
