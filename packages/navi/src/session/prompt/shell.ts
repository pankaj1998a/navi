import path from "path"
import { spawn } from "child_process"
import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import { Agent } from "../../agent/agent"
import { Session } from ".."
import { SessionRevert } from "../revert"
import { Instance } from "../../project/instance"
import { Shell } from "../../shell/shell"
import { ulid } from "ulid"
import { defer } from "../../util/defer"
import { Log } from "../../util/log"
import { state } from "./state"
import { SessionStatus } from "../status"
import { getPermissionMode, Permission } from "../../permission"
import { getThinkingLevel } from "../../agent/thinking-levels"

const log = Log.create({ service: "session.prompt.shell" })

/**
 * Extracted shell handler from prompt.ts
 */

function start(sessionID: string) {
    const s = state()
    if (s[sessionID]) return
    const controller = new AbortController()
    s[sessionID] = {
        abort: controller,
        callbacks: [],
    }
    return controller.signal
}

function cancel(sessionID: string) {
    log.info("cancel", { sessionID })
    const s = state()
    const match = s[sessionID]
    if (!match) return
    match.abort.abort()
    for (const item of match.callbacks) {
        item.reject()
    }
    delete s[sessionID]
    SessionStatus.set(sessionID, {
        type: "idle",
        permissionMode: getPermissionMode(sessionID),
        thinkingLevel: getThinkingLevel(sessionID),
    })
    return
}

export async function executeShell(input: {
    sessionID: string
    agent: string
    command: string
    model?: { providerID: string; modelID: string }
    lastModel: (sessionID: string) => Promise<{ providerID: string; modelID: string }>
}) {
    const abort = start(input.sessionID)
    if (!abort) {
        throw new Session.BusyError(input.sessionID)
    }
    using _ = defer(() => cancel(input.sessionID))

    const session = await Session.get(input.sessionID)
    if (session.revert) {
        SessionRevert.cleanup(session)
    }
    const agent = await Agent.get(input.agent)
    const model = input.model ?? agent.model ?? (await input.lastModel(input.sessionID))
    const userMsg: MessageV2.User = {
        id: Identifier.ascending("message"),
        sessionID: input.sessionID,
        time: {
            created: Date.now(),
        },
        role: "user",
        agent: input.agent,
        model: {
            providerID: model.providerID,
            modelID: model.modelID,
        },
    }
    await Session.updateMessage(userMsg)
    const userPart: MessageV2.Part = {
        type: "text",
        id: Identifier.ascending("part"),
        messageID: userMsg.id,
        sessionID: input.sessionID,
        text: "The following tool was executed by the user",
        synthetic: true,
    }
    await Session.updatePart(userPart)

    const msg: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
        sessionID: input.sessionID,
        parentID: userMsg.id,
        mode: input.agent,
        agent: input.agent,
        cost: 0,
        path: {
            cwd: Instance.directory,
            root: Instance.worktree,
        },
        time: {
            created: Date.now(),
        },
        role: "assistant",
        tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
        },
        modelID: model.modelID,
        providerID: model.providerID,
    }
    await Session.updateMessage(msg)
    const part: MessageV2.Part = {
        type: "tool",
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: input.sessionID,
        tool: "bash",
        callID: ulid(),
        state: {
            status: "running",
            time: {
                start: Date.now(),
            },
            input: {
                command: input.command,
            },
        },
    }
    await Session.updatePart(part)
    const shell = Shell.preferred()
    const shellName = (
        process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
    ).toLowerCase()

    const invocations: Record<string, { args: string[] }> = {
        nu: { args: ["-c", input.command] },
        fish: { args: ["-c", input.command] },
        zsh: {
            args: [
                "-c",
                "-l",
                `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
            ],
        },
        bash: {
            args: [
                "-c",
                "-l",
                `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
            ],
        },
        cmd: { args: ["/c", input.command] },
        powershell: { args: ["-NoProfile", "-Command", input.command] },
        pwsh: { args: ["-NoProfile", "-Command", input.command] },
        "": { args: ["-c", `${input.command}`] },
    }

    const matchingInvocation = invocations[shellName] ?? invocations[""]
    const args = matchingInvocation?.args

    const proc = spawn(shell, args, {
        cwd: Instance.directory,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
            TERM: "dumb",
        },
    })

    let output = ""

    proc.stdout?.on("data", (chunk) => {
        output += chunk.toString()
        if (part.state.status === "running") {
            part.state.metadata = {
                output: output,
                description: "",
            }
            Session.updatePart(part)
        }
    })

    proc.stderr?.on("data", (chunk) => {
        output += chunk.toString()
        if (part.state.status === "running") {
            part.state.metadata = {
                output: output,
                description: "",
            }
            Session.updatePart(part)
        }
    })

    let aborted = false
    let exited = false

    const kill = () => Shell.killTree(proc, { exited: () => exited })

    if (abort.aborted) {
        aborted = true
        await kill()
    }

    const abortHandler = () => {
        aborted = true
        void kill()
    }

    abort.addEventListener("abort", abortHandler, { once: true })

    await new Promise<void>((resolve) => {
        proc.on("close", () => {
            exited = true
            abort.removeEventListener("abort", abortHandler)
            resolve()
        })
    })

    if (aborted) {
        output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
    }
    msg.time.completed = Date.now()
    await Session.updateMessage(msg)
    if (part.state.status === "running") {
        part.state = {
            status: "completed",
            time: {
                ...part.state.time,
                end: Date.now(),
            },
            input: part.state.input,
            title: "",
            metadata: {
                output,
                description: "",
            },
            output,
        }
        await Session.updatePart(part)
    }
    return { info: msg, parts: [part] }
}



