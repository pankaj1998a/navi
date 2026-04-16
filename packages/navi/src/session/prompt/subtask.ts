import { MessageV2 } from "../message-v2"
import { Provider } from "../../provider/provider"
import { Session } from ".."
import { TaskTool } from "../../tool/task"
import { Identifier } from "../../id/id"
import { Instance } from "../../project/instance"
import { ulid } from "ulid"
import { Plugin } from "../../plugin"
import { Agent } from "../../agent/agent"
import { Tool } from "../../tool/tool"
import { PermissionNext } from "../../permission/next"
import { Log } from "../../util/log"
import { ProviderID, ModelID } from "../../provider/schema"
import { MessageID, SessionID, PartID } from "../../session/schema"

const log = Log.create({ service: "session.prompt.subtask" })

export async function executeSubtask(input: {
    task: MessageV2.SubtaskPart
    lastUser: MessageV2.User
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
    session: Session.Info
    messages: MessageV2.WithParts[]
}) {
    const { task, lastUser, sessionID, model, abort, session, messages } = input
    const taskTool = await TaskTool.init()
    const assistantMessage = (await Session.updateMessage({
        id: MessageID.make(Identifier.ascending("message")),
        role: "assistant",
        parentID: lastUser.id,
        sessionID: SessionID.make(sessionID),
        mode: task.agent,
        agent: task.agent,
        path: {
            cwd: Instance.directory,
            root: Instance.worktree,
        },
        cost: 0,
        tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
        },
        modelID: ModelID.make(model.id),
        providerID: ProviderID.make(model.providerID),
        time: {
            created: Date.now(),
        },
    })) as MessageV2.Assistant
    let part = (await Session.updatePart({
        id: PartID.make(Identifier.ascending("part")),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
            status: "running",
            input: {
                prompt: task.prompt,
                description: task.description,
                subagent_type: task.agent,
                command: task.command,
            },
            time: {
                start: Date.now(),
            },
        },
    })) as MessageV2.ToolPart
    const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
    }
    await Plugin.trigger(
        "tool.execute.before",
        {
            tool: "task",
            sessionID: SessionID.make(sessionID),
            callID: part.id,
        },
        { args: taskArgs },
    )
    let executionError: Error | undefined
    const taskAgent = await Agent.get(task.agent)
    const taskCtx: Tool.Context = {
        agent: task.agent,
        messageID: assistantMessage.id,
        sessionID: SessionID.make(sessionID),
        abort,
        callID: part.callID,
        extra: { bypassAgentCheck: true },
        messages: [...messages, { info: assistantMessage, parts: [part] }],
        async metadata(input) {
            await Session.updatePart({
                ...part,
                type: "tool",
                state: {
                    ...part.state,
                    ...input,
                },
            } satisfies MessageV2.ToolPart)
        },
        async ask(req) {
            await PermissionNext.ask({
                ...req,
                sessionID: SessionID.make(sessionID),
                ruleset: PermissionNext.merge(taskAgent.permission, session.permission ?? []),
            })
        },
    }
    const result = await taskTool.execute(taskArgs, taskCtx).catch((error) => {
        executionError = error
        log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
        return undefined
    })
    await Plugin.trigger(
        "tool.execute.after",
        {
            tool: "task",
            sessionID: SessionID.make(sessionID),
            callID: part.id,
        },
        result,
    )
    assistantMessage.finish = "tool-calls"
    assistantMessage.time.completed = Date.now()
    await Session.updateMessage(assistantMessage)
    if (result && part.state.status === "running") {
        await Session.updatePart({
            ...part,
            state: {
                status: "completed",
                input: part.state.input,
                title: result.title,
                metadata: result.metadata,
                output: result.output,
                attachments: result.attachments,
                time: {
                    ...part.state.time,
                    end: Date.now(),
                },
            },
        } satisfies MessageV2.ToolPart)
    }
    if (!result) {
        await Session.updatePart({
            ...part,
            state: {
                status: "error",
                error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
                time: {
                    start: part.state.status === "running" ? part.state.time.start : Date.now(),
                    end: Date.now(),
                },
                metadata: part.metadata,
                input: part.state.input,
            },
        } satisfies MessageV2.ToolPart)
    }

    // Add synthetic user message to prevent certain reasoning models from erroring
    // If we create assistant messages w/ out user ones following mid loop thinking signatures
    // will be missing and it can cause errors for models like gemini for example
    const summaryUserMsg: MessageV2.User = {
        id: MessageID.make(Identifier.ascending("message")),
        sessionID: SessionID.make(sessionID),
        role: "user",
        time: {
            created: Date.now(),
        },
        agent: lastUser.agent,
        model: lastUser.model,
    }
    await Session.updateMessage(summaryUserMsg)
    await Session.updatePart({
        id: PartID.make(Identifier.ascending("part")),
        messageID: summaryUserMsg.id,
        sessionID: SessionID.make(sessionID),
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
    } satisfies MessageV2.TextPart)
}



