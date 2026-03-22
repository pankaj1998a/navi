import type { Argv } from "yargs"
import path from "path"
import { execFileSync } from "child_process"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { bootstrap } from "../bootstrap"
import { Command } from "../../command"
import { EOL } from "os"
import * as prompts from "@clack/prompts"
import { createNaviClient, type NaviClient } from "@navi-ai/sdk/v2"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"
import { Auth } from "../../auth"
import { Agent } from "../../agent/agent"
import { Question } from "../../question"
import { Todo } from "../../session/todo"
import { Identifier } from "../../id/id"

const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

function workflowGuidanceForCommand(command?: string) {
  if (!command) return undefined
  const lower = command.toLowerCase()
  const guidance: string[] = []

  if (/\b(?:bun|npm|pnpm|yarn|pip|poetry|cargo|go|mvn|gradle)\s+(?:install|add|update|upgrade)\b/i.test(lower)) {
    guidance.push(
      "Install workflow: inspect the lockfile or dependency manifest first, keep changes scoped, and report any failing registry or package-resolution step.",
    )
  }

  if (/\b(?:bun|npm|pnpm|yarn)\s+(?:test|run\s+test)\b|\bpytest\b|\bcargo\s+test\b|\bgo\s+test\b|\bmvn\s+test\b/i.test(lower)) {
    guidance.push(
      "Test workflow: run the smallest relevant subset first, read the first failing assertion or stack trace, and surface the next most useful validation command.",
    )
  }

  if (/\b(?:lint|eslint|prettier|ruff|flake8|tsc|typecheck)\b/i.test(lower)) {
    guidance.push(
      "Lint workflow: fix the reported rules directly, keep the diff minimal, and avoid unrelated refactors while cleaning style or type errors.",
    )
  }

  if (/\b(?:bun|npm|pnpm|yarn|cargo|go|mvn|gradle|make)\s+(?:build|compile|package)\b|\b(?:build|compile)\b/i.test(lower)) {
    guidance.push(
      "Build workflow: treat failures as compile or packaging regressions, identify the first root error, and report the exact file or symbol that needs attention.",
    )
  }

  if (/\bdebug\b|\btroubleshoot\b|\btrace\b|\bcrash\b|\bfailing\b/i.test(lower)) {
    guidance.push(
      "Debug workflow: derive the narrowest reproduction, gather logs and stack traces first, and localize one hypothesis at a time before editing.",
    )
  }

  if (guidance.length === 0) return undefined
  return [`<workflow_guidance>`, ...guidance.map((line) => ` - ${line} `), ` </workflow_guidance>`].join("\n")
}

function proceedWhileRunningForCommand(input: { command?: string; proceed?: boolean }) {
  const lower = input.command?.toLowerCase() ?? ""
  const shouldProceed =
    input.proceed === true ||
    /\b(?:dev|serve|server|watch|storybook|playwright|vitest|jest|pytest|test)\b/i.test(lower)

  if (!shouldProceed) return undefined

  return [
    "<proceed_while_running>",
    "When the task launches a long-running command, do not block the whole session waiting for it.",
    "Start it in the background or detach it, keep the session moving, and report how to inspect logs or status later.",
    "Use follow-up tasks or verification steps while the process continues if there is useful work available.",
    "If the command fails quickly, treat the failure normally and do not leave a stale background process behind.",
    "</proceed_while_running>",
  ].join("\n")
}

function routePlannerForInput(input: { command?: string; message?: string; simple?: boolean }) {
  const text = [input.command, input.message].filter(Boolean).join(" ").toLowerCase()
  const steps: string[] = []

  if (input.simple || text.trim().length < 80) {
    steps.push("Simple task mode: prefer a single-agent answer and avoid delegation unless a blocker appears.")
  }

  if (/\b(latest|current|today|yesterday|web|browser|search|docs|pricing|release notes|github issue)\b/i.test(text)) {
    steps.push("Primary route: web grounding first, then verify against authoritative sources.")
  }

  if (/\b(file|path|code|stack trace|error|bug|refactor|test|lint|build|repo|workspace|symbol)\b/i.test(text) || /@([a-zA-Z0-9_\-\.\/]+)/.test(text)) {
    steps.push("Primary route: inspect the local codebase first with search/read/investigator before asking the web.")
  }

  if (/\b(review|diff|branch|pr|pull request|patch)\b/i.test(text)) {
    steps.push("Primary route: review the diff or branch context before suggesting edits.")
  }

  if (/\b(browser|screenshot|ui|visual|layout)\b/i.test(text)) {
    steps.push("Primary route: use browser verification after the main answer or edit.")
  }

  if (!steps.length) return undefined
  return [`<route_plan>`, ...steps.map((line) => `- ${line}`), `</route_plan>`].join("\n")
}

function readGitCommand(args: string[]) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()
  } catch {
    return ""
  }
}

function buildPresetContext(preset?: string) {
  if (!preset) return undefined
  const branch = readGitCommand(["branch", "--show-current"])
  const status = readGitCommand(["status", "--short"])
  const diffStat = readGitCommand(["diff", "--stat", "--", "."])
  const cwd = process.cwd()
  const lines = ["<workspace_context>", `Preset: ${preset}`, `Working directory: ${cwd}`]

  if (branch) lines.push(`Branch: ${branch}`)

  if (preset === "branch") {
    if (status) {
      lines.push("Git status:")
      lines.push(status)
    } else {
      lines.push("Git status: clean")
    }
  }

  if (preset === "task" || preset === "workspace") {
    if (status) {
      lines.push("Changed files:")
      lines.push(status)
    } else {
      lines.push("Changed files: none")
    }
    if (diffStat) {
      lines.push("Diff stat:")
      lines.push(diffStat)
    }
  }

  if (preset === "workspace") {
    lines.push("Use the current worktree and changed files as the initial context for this task.")
  }

  lines.push("</workspace_context>")
  return lines.join("\n")
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run navi with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("simple", {
        type: "boolean",
        describe: "use a lightweight single-agent answer mode for short tasks",
      })
      .option("preset", {
        type: "string",
        choices: ["branch", "task", "workspace"],
        describe: "attach a starter workspace context preset to the session",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running navi server (e.g., http://localhost:4096)",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("auto", {
        type: "boolean",
        describe: "automatically answer questions and reject permissions for non-interactive runs",
      })
      .option("proceed", {
        type: "boolean",
        describe: "prefer detached/background execution for long-running commands and keep working while they run",
      })
  },
  handler: async (args) => {
    let message = [...args.message, ...(args["--"] || [])]
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ")

    const fileParts: any[] = []
    if (args.file) {
      const files = Array.isArray(args.file) ? args.file : [args.file]

      for (const filePath of files) {
        const resolvedPath = path.resolve(process.cwd(), filePath)
        const file = Bun.file(resolvedPath)
        const stats = await file.stat().catch(() => { })
        if (!stats) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }
        if (!(await file.exists())) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }

        const stat = await file.stat()
        const mime = stat.isDirectory() ? "application/x-directory" : "text/plain"

        fileParts.push({
          type: "file",
          url: `file://${resolvedPath}`,
          filename: path.basename(resolvedPath),
          mime,
        })
      }
    }

    if (!process.stdin.isTTY) message += "\n" + (await Bun.stdin.text())

    // Feature 4: Terminal-Native Mentions (@file support)
    // Resolve @file mentions in the message and attach them as file parts
    const mentionPattern = /@([a-zA-Z0-9_\-\.\/]+)/g
    let match
    while ((match = mentionPattern.exec(message)) !== null) {
      const filePath = match[1]
      const resolvedPath = path.resolve(process.cwd(), filePath)
      const file = Bun.file(resolvedPath)
      if (await file.exists()) {
        const stat = await file.stat()
        if (!stat.isDirectory()) {
          fileParts.push({
            type: "file",
            url: `file://${resolvedPath}`,
            filename: path.basename(resolvedPath),
            mime: "text/plain",
          })
          UI.println(UI.Style.TEXT_INFO + `~  Attached mentioned file: ${filePath}`)
        }
      }
    }

    const presetContext = buildPresetContext(args.preset)
    const workflowContext = workflowGuidanceForCommand(args.command)
    const proceedContext = proceedWhileRunningForCommand({
      command: args.command,
      proceed: args.proceed,
    })
    const routePlan = routePlannerForInput({
      command: args.command,
      message,
      simple: args.simple,
    })
    const injectedContext = [presetContext, workflowContext, proceedContext, routePlan].filter(Boolean).join("\n\n")

    if (message.trim().length === 0 && !args.command && !args.preset) {
      return
    }

    const execute = async (sdk: NaviClient, sessionID: string) => {
      const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI)
      const shouldAuto = Boolean(args.auto || !isInteractive || args.format === "json")

      const printEvent = (color: string, type: string, title: string) => {
        UI.println(
          color + `|`,
          UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
          "",
          UI.Style.TEXT_NORMAL + title,
        )
      }

      const outputJsonEvent = (type: string, data: any) => {
        if (args.format === "json") {
          process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
          return true
        }
        return false
      }

      const describePermission = (permission: any) => {
        if (!permission?.metadata) return undefined
        const metadata = permission.metadata as Record<string, unknown>
        const parts: string[] = []
        if (typeof metadata.summary === "string" && metadata.summary.trim()) parts.push(metadata.summary.trim())
        if (typeof metadata.command === "string" && metadata.command.trim()) parts.push(`$ ${metadata.command.trim()}`)
        if (typeof metadata.cwd === "string" && metadata.cwd.trim()) parts.push(`cwd=${metadata.cwd.trim()}`)
        if (typeof metadata.risk === "string" && metadata.risk.trim()) parts.push(`risk=${metadata.risk.trim()}`)
        if (metadata.destructive === true) parts.push("destructive")
        const paths = Array.isArray(metadata.paths) ? metadata.paths.filter((x) => typeof x === "string") : []
        if (paths.length > 0) parts.push(`paths=${paths.join(", ")}`)
        const warnings = Array.isArray(metadata.warnings) ? metadata.warnings.filter((x) => typeof x === "string") : []
        if (warnings.length > 0) parts.push(`warnings=${warnings.length}`)
        return parts.length > 0 ? parts.join(" · ") : undefined
      }

      const questionChoices = (question: Question.Info) =>
        question.options.map((option) => ({
          label: option.label,
          value: option.label,
          hint: option.description,
        }))

      const defaultQuestionAnswer = (question: Question.Info) => {
        const recommended = question.recommendedOption
        if (recommended && question.options.some((option) => option.label === recommended)) {
          return recommended
        }
        return question.options[0]?.label
      }

      const answerQuestion = async (request: Question.Info): Promise<Question.Answer> => {
        if (shouldAuto) {
          const fallback = defaultQuestionAnswer(request)
          if (!fallback) return []
          if (request.multiple) return [fallback]
          return [fallback]
        }

        if (request.options.length === 0) {
          const result = await prompts.text({
            message: request.question,
            placeholder: request.why ?? "Type your answer",
            validate: (value) => (value.trim().length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(result)) {
            throw new UI.CancelledError()
          }
          return [result.toString().trim()]
        }

        if (request.multiple) {
          const initialValues = request.recommendedOption
            ? request.options.some((option) => option.label === request.recommendedOption)
              ? [request.recommendedOption]
              : []
            : request.options.length === 1
              ? [request.options[0]!.label]
              : []
          const result = await prompts.multiselect({
            message: request.question,
            options: questionChoices(request),
            initialValues,
          })
          if (prompts.isCancel(result)) {
            throw new UI.CancelledError()
          }
          return result
        }

        const initialValue = defaultQuestionAnswer(request) ?? request.options[0]!.label
        const result = await prompts.select({
          message: request.question,
          options: questionChoices(request),
          initialValue,
        })
        if (prompts.isCancel(result)) {
          throw new UI.CancelledError()
        }
        return [result.toString()]
      }

      const answerQuestions = async (requests: Question.Info[]) => {
        const answers: Question.Answer[] = []
        for (const request of requests) {
          answers.push(await answerQuestion(request))
        }
        return answers
      }

      const parseFollowUpHints = (output: string) => {
        const hints = new Set<string>()
        for (const rawLine of output.split(/\r?\n/)) {
          const line = rawLine.trim()
          if (!line) continue
          if (/^(error|failed|fatal|exception)\b/i.test(line)) {
            hints.add(line)
            continue
          }
          const match = line.match(/^(.+?):(\d+)(?::(\d+))?:\s*(.+)$/)
          if (match) {
            const location = `${match[1]}:${match[2]}${match[3] ? `:${match[3]}` : ""}`
            hints.add(`${location} → ${match[4]}`)
          }
        }
        return Array.from(hints).slice(0, 5)
      }

      const createFollowUpTodos = async (command: string | undefined, hints: string[]) => {
        const summary = command?.trim()
          ? `Investigate failed command: ${command.trim()}`
          : "Investigate failed command output"
        const details = hints.length > 0 ? `\n${hints.map((hint) => `- ${hint}`).join("\n")}` : ""
        const content = `${summary}${details}`
        const todos = await Todo.get(sessionID)
        if (todos.some((todo) => todo.content === content && todo.status !== "completed")) return
        await Todo.update({
          sessionID,
          todos: [
            {
              id: Identifier.ascending("todo"),
              content,
              status: "pending",
              priority: "high",
            },
            ...todos,
          ],
        })
      }

      const events = await sdk.event.subscribe()
      let errorMsg: string | undefined

      const printStartupDiagnostics = async () => {
        if (args.format === "json" || !process.stdout.isTTY) return
        const providers = await Provider.list()
        const providerIDs = Object.keys(providers).sort((a, b) => a.localeCompare(b)).slice(0, 5)
        if (providerIDs.length > 0) {
          const summary = await Promise.all(
            providerIDs.map(async (providerID) => {
              const provider = providers[providerID]
              const auth = await Auth.get(providerID).catch(() => undefined)
              const status = auth
                ? "connected"
                : provider.source === "config"
                  ? "configured"
                  : provider.source === "free"
                    ? "free"
                    : provider.source
              return `${providerID}=${status}`
            }),
          )
          UI.println(UI.Style.TEXT_DIM + `Auth: ${summary.join(", ")}` + UI.Style.TEXT_NORMAL)
        }
        if (args.simple && !args.agent) {
          UI.println(UI.Style.TEXT_DIM + "Simple mode: using a lightweight ask-style agent" + UI.Style.TEXT_NORMAL)
        }
        if (Flag.NAVI_MAX_BUDGET_USD) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD +
            `Budget guard: $${Flag.NAVI_MAX_BUDGET_USD.toFixed(2)}` +
            UI.Style.TEXT_NORMAL,
          )
        }
        if (Flag.NAVI_MAX_TURNS) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD +
            `Turn guard: ${Flag.NAVI_MAX_TURNS} turns` +
            UI.Style.TEXT_NORMAL,
          )
        }
      }

      const eventProcessor = (async () => {
        for await (const event of events.stream) {
          if (event.type === "message.part.updated") {
            const part = event.properties.part
            if (part.sessionID !== sessionID) continue

            if (part.type === "tool" && part.state.status === "completed") {
              if (outputJsonEvent("tool_use", { part })) continue
              const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
              const title =
                part.state.title ||
                (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "Unknown")
              printEvent(color, tool, title)
              if (part.tool === "bash" && part.state.output?.trim()) {
                UI.println()
                UI.println(part.state.output)
                const exitCode = typeof part.state.metadata?.exit === "number" ? part.state.metadata.exit : undefined
                const followUpHints =
                  exitCode !== undefined && exitCode !== 0 ? parseFollowUpHints(part.state.output).filter(Boolean) : []
                if (followUpHints.length > 0) {
                  await createFollowUpTodos(typeof part.state.input?.command === "string" ? part.state.input.command : undefined, followUpHints)
                  outputJsonEvent("follow_up", {
                    command: typeof part.state.input?.command === "string" ? part.state.input.command : undefined,
                    exitCode,
                    hints: followUpHints,
                  })
                  UI.println()
                  UI.println(UI.Style.TEXT_WARNING_BOLD + "!" + UI.Style.TEXT_NORMAL + " Follow-up hints")
                  for (const hint of followUpHints) {
                    UI.println(UI.Style.TEXT_WARNING_BOLD + "  - " + UI.Style.TEXT_NORMAL + hint)
                  }
                }
              }
            }

            if (part.type === "step-start") {
              if (outputJsonEvent("step_start", { part })) continue
            }

            if (part.type === "step-finish") {
              if (outputJsonEvent("step_finish", { part })) continue
            }

            if (part.type === "text" && part.time?.end) {
              if (outputJsonEvent("text", { part })) continue
              const isPiped = !process.stdout.isTTY
              if (!isPiped) UI.println()
              process.stdout.write((isPiped ? part.text : UI.markdown(part.text)) + EOL)
              if (part.response?.summary || part.response?.nextStep || part.response?.blockedReason) {
                if (!isPiped) UI.println()
                if (part.response?.summary) {
                  UI.println(UI.Style.TEXT_DIM + "Summary:" + UI.Style.TEXT_NORMAL + ` ${part.response.summary}`)
                }
                if (part.response?.nextStep) {
                  UI.println(UI.Style.TEXT_DIM + "Next:" + UI.Style.TEXT_NORMAL + ` ${part.response.nextStep}`)
                }
                if (part.response?.blockedReason) {
                  UI.println(UI.Style.TEXT_WARNING_BOLD + "Blocked:" + UI.Style.TEXT_NORMAL + ` ${part.response.blockedReason}`)
                }
              }
              if (!isPiped) UI.println()
            }
          }

          if (event.type === "session.error") {
            const props = event.properties
            if (props.sessionID !== sessionID || !props.error) continue
            let err = String(props.error.name)
            if ("data" in props.error && props.error.data && "message" in props.error.data) {
              err = String(props.error.data.message)
            }
            errorMsg = errorMsg ? errorMsg + EOL + err : err
            if (outputJsonEvent("error", { error: props.error })) continue
            UI.error(err)
          }

          if (event.type === "question.asked") {
            const request = event.properties
            if (request.sessionID !== sessionID) continue
            if (!outputJsonEvent("question", { request })) {
              UI.println(
                UI.Style.TEXT_WARNING_BOLD + "?",
                UI.Style.TEXT_NORMAL,
                `Question required (${request.questions.length})`,
              )
            }

            try {
              const answers = await answerQuestions(request.questions)
              await sdk.question.reply({
                requestID: request.id,
                answers,
              })
            } catch (error) {
              if (error instanceof UI.CancelledError) {
                await sdk.question.reject({
                  requestID: request.id,
                })
                continue
              }
              throw error
            }
          }

          if (event.type === "session.idle" && event.properties.sessionID === sessionID) {
            break
          }

          if (event.type === "permission.asked") {
            const permission = event.properties
            if (permission.sessionID !== sessionID) continue
            const response = shouldAuto
              ? ("reject" as const)
              : ((await prompts
                .select({
                  message: `Permission required: ${permission.permission} (${permission.patterns.join(", ")})`,
                  options: [
                    { value: "once", label: "Allow once" },
                    { value: "always", label: "Always allow: " + permission.always.join(", ") },
                    { value: "reject", label: "Reject" },
                  ],
                  initialValue: "once",
                })
                .catch(() => "reject")) as "once" | "always" | "reject")
            if (!outputJsonEvent("permission", { permission, summary: describePermission(permission) })) {
              const summary = describePermission(permission)
              if (summary) {
                UI.println(UI.Style.TEXT_WARNING_BOLD + "!" + UI.Style.TEXT_NORMAL, summary)
              }
            }
            await sdk.permission.respond({
              sessionID,
              permissionID: permission.id,
              response,
            })
          }
        }
      })()

      // Validate agent if specified
      const allowSubagent = Boolean((args as any).allowSubagent)
      const effectiveAgent = args.agent ?? (args.simple ? "ask" : undefined)
      const resolvedAgent = await (async () => {
        if (!effectiveAgent) return undefined
        const agent = await Agent.get(effectiveAgent)
        if (!agent) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${effectiveAgent}" not found. Falling back to default agent`,
          )
          return undefined
        }
        if (agent.mode === "subagent") {
          if (allowSubagent) {
            return effectiveAgent
          }
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${effectiveAgent}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }
        return effectiveAgent
      })()

      if (args.command) {
        await sdk.session.command({
          sessionID,
          agent: resolvedAgent,
          model: args.model,
          command: args.command,
          arguments: [injectedContext, message].filter(Boolean).join("\n\n"),
          variant: args.variant,
        })
      } else {
        const modelParam = args.model ? Provider.parseModel(args.model) : undefined
        await sdk.session.prompt({
          sessionID,
          agent: resolvedAgent,
          model: modelParam,
          variant: args.variant,
          parts: [
            ...(injectedContext ? [{ type: "text", text: injectedContext, synthetic: true }] : []),
            ...fileParts,
            { type: "text", text: message },
          ],
        })
      }

      await eventProcessor
      if (errorMsg) process.exit(1)
    }

    if (args.attach) {
      const sdk = createNaviClient({ baseUrl: args.attach })

      const sessionID = await (async () => {
        if (args.continue) {
          const result = await sdk.session.list()
          return result.data?.find((s) => !s.parentID)?.id
        }
        if (args.session) return args.session

        const title =
          args.title !== undefined
            ? args.title === ""
              ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
              : args.title
            : undefined

        const result = await sdk.session.create(
          title
            ? {
              title,
              permission: [
                {
                  permission: "question",
                  action: "deny",
                  pattern: "*",
                },
              ],
            }
            : {
              permission: [
                {
                  permission: "question",
                  action: "deny",
                  pattern: "*",
                },
              ],
            },
        )
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      const cfgResult = await sdk.config.get()
      if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.NAVI_AUTO_SHARE || args.share)) {
        const shareResult = await sdk.session.share({ sessionID }).catch((error) => {
          if (error instanceof Error && error.message.includes("disabled")) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
          }
          return { error }
        })
        if (!shareResult.error && "data" in shareResult && shareResult.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + shareResult.data.share.url)
        }
      }

      await printStartupDiagnostics()
      return await execute(sdk, sessionID)
    }

    await bootstrap(process.cwd(), async () => {
      if (process.stdin.isTTY && !process.env.CI) {
        const { Onboarding } = await import("../onboarding")
        await Onboarding.checkAndRun()
      }

      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.App().fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createNaviClient({ baseUrl: "http://navi.internal", fetch: fetchFn })

      if (args.command) {
        const exists = await Command.get(args.command)
        if (!exists) {
          UI.error(`Command "${args.command}" not found`)
          process.exit(1)
        }
      }

      const sessionID = await (async () => {
        if (args.continue) {
          const result = await sdk.session.list()
          return result.data?.find((s) => !s.parentID)?.id
        }
        if (args.session) return args.session

        const title =
          args.title !== undefined
            ? args.title === ""
              ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
              : args.title
            : undefined

        const result = await sdk.session.create(title ? { title } : {})
        return result.data?.id
      })()

      if (!sessionID) {
        UI.error("Session not found")
        process.exit(1)
      }

      const cfgResult = await sdk.config.get()
      if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.NAVI_AUTO_SHARE || args.share)) {
        const shareResult = await sdk.session.share({ sessionID }).catch((error) => {
          if (error instanceof Error && error.message.includes("disabled")) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
          }
          return { error }
        })
        if (!shareResult.error && "data" in shareResult && shareResult.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + shareResult.data.share.url)
        }
      }

      await printStartupDiagnostics()
      await execute(sdk, sessionID)
    })
  },
})
