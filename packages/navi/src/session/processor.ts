import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { formatNaviResponseText, parseNaviResponse, type NaviResponse, type ResponseQuestion } from "./response"
import { AgentPolicy } from "@/agent/policy"
import { SessionTrace } from "./trace"
import { EvalFramework } from "@/eval/framework"
import { ProviderReliability } from "@/provider/reliability"
import { AgentScorecard } from "@/agent/scorecard"
import { ResearchLedger } from "./research-ledger"
// SessionValidation disabled - was blocking responses and leaking data into TUI
// import { SessionValidation } from "./validation"


export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  function getErrorMessage(error: MessageV2.Assistant["error"]) {
    if (!error) return undefined
    return "message" in error.data ? error.data.message : undefined
  }

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process")
        needsCompaction = false
        const taskClass = await resolveTaskClass(input.sessionID, streamInput.agent.name)
        let pendingQuestion: ResponseQuestion | undefined
        let lastResponse: NaviResponse | undefined
        let toolCallCount = 0
        let structuredQuestionCount = 0
        let delegationCount = 0
        const policy = AgentPolicy.resolve(streamInput.agent.name, streamInput.agent.executionPolicy)
        const shouldBreak = (await Config.get()).experimental?.continue_loop_on_deny !== true
        const maxRetries = streamInput.retries ?? policy.maxRetries ?? 0
        while (true) {
        try {
          let currentText: MessageV2.TextPart | undefined
          let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
          const stream = await LLM.stream(streamInput)

            for await (const value of stream.fullStream) {
              log.info("stream event", { type: value.type })
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, {
                    type: "busy",
                    phase: phaseForTaskClass(taskClass),
                    taskClass,
                    activeAgents: [streamInput.agent.name],
                    activeTools: Object.keys(streamInput.tools),
                    nextAction:
                      taskClass === "vibemode"
                        ? "plan the next delegation chunk"
                        : "waiting for model response",
                  })
                  break

                case "reasoning-start":
                  if (value.id in reasoningMap) {
                    continue
                  }
                  reasoningMap[value.id] = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "reasoning-delta":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    if (part.text) await Session.updatePart({ part, delta: value.text })
                  }
                  break

                case "reasoning-end":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    await Session.updatePart(part)
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start":
                  const part = await Session.updatePart({
                    id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "tool",
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: "pending",
                      input: {},
                      raw: "",
                    },
                  })
                  toolcalls[value.id] = part as MessageV2.ToolPart
                  break

                case "tool-input-delta":
                  break

                case "tool-input-end":
                  break

                case "tool-call": {
                  toolCallCount++
                  if (policy.maxToolCalls && toolCallCount > policy.maxToolCalls) {
                    throw new Error(`Execution policy exceeded: maxToolCalls=${policy.maxToolCalls}`)
                  }
                  if (AgentPolicy.isDelegationTool(value.toolName)) {
                    delegationCount++
                    if (policy.maxDelegations && delegationCount > policy.maxDelegations) {
                      throw new Error(`Execution policy exceeded: maxDelegations=${policy.maxDelegations}`)
                    }
                  }
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart
                    SessionStatus.set(input.sessionID, {
                      type: "busy",
                      phase: AgentPolicy.isDelegationTool(value.toolName) ? "delegating" : "running",
                      taskClass,
                      activeAgents: [streamInput.agent.name],
                      activeTools: [value.toolName],
                      nextAction: "waiting for tool result",
                    })

                    const parts = await MessageV2.parts(input.assistantMessage.id)
                    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

                    if (
                      lastThree.length === DOOM_LOOP_THRESHOLD &&
                      lastThree.every(
                        (p) =>
                          p.type === "tool" &&
                          p.tool === value.toolName &&
                          p.state.status !== "pending" &&
                          JSON.stringify(p.state.input) === JSON.stringify(value.input),
                      )
                    ) {
                      const agent = await Agent.get(input.assistantMessage.agent)
                      await PermissionNext.ask({
                        permission: "doom_loop",
                        patterns: [value.toolName],
                        sessionID: input.assistantMessage.sessionID,
                        metadata: {
                          tool: value.toolName,
                          input: value.input,
                        },
                        always: [value.toolName],
                        ruleset: agent.permission,
                      })
                    }
                  }
                  break
                }
                case "tool-result": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments: value.output.attachments,
                      },
                    })

                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input,
                        error: (value.error as any).toString(),
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    })

                    if (
                      value.error instanceof PermissionNext.RejectedError ||
                      value.error instanceof Question.RejectedError
                    ) {
                      blocked = shouldBreak
                      SessionStatus.set(input.sessionID, {
                        type: "busy",
                        phase: "blocked",
                        taskClass,
                        activeAgents: [streamInput.agent.name],
                        blockedReason:
                          value.error instanceof PermissionNext.RejectedError
                            ? "permission rejected"
                            : "question rejected",
                        nextAction: "wait for user steering",
                      })
                    }
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }
                case "error":
                  throw value.error

                case "start-step":
                  snapshot = await Snapshot.track()
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    snapshot,
                    type: "step-start",
                  })
                  break

                case "finish-step": {
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage,
                    metadata: value.providerMetadata,
                  })
                  input.assistantMessage.finish = value.finishReason
                  input.assistantMessage.cost += usage.cost
                  input.assistantMessage.tokens = usage.tokens
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    reason: value.finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "step-finish",
                    tokens: usage.tokens,
                    cost: usage.cost,
                  })
                  await Session.updateMessage(input.assistantMessage)
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot)
                    if (patch.files.length) {
                      await Session.updatePart({
                        id: Identifier.ascending("part"),
                        messageID: input.assistantMessage.id,
                        sessionID: input.sessionID,
                        type: "patch",
                        hash: patch.hash,
                        files: patch.files,
                      })
                    }
                    snapshot = undefined
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  })
                  if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
                    needsCompaction = true
                  }
                  break
                }

                case "text-start":
                  currentText = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "text-delta":
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    if (currentText.text)
                      await Session.updatePart({
                        part: currentText,
                        delta: value.text,
                      })
                  }
                  break

                case "text-end":
                  if (currentText) {
                    currentText.text = currentText.text.trimEnd()
                    const textOutput = await Plugin.trigger(
                      "experimental.text.complete",
                      {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        partID: currentText.id,
                      },
                      { text: currentText.text },
                    )
                    currentText.text = textOutput.text
                    currentText.time = {
                      start: Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    // Parse unified response envelope from the completed text
                    currentText.response = parseNaviResponse(currentText.text)
                    lastResponse = currentText.response
                    currentText.text = formatNaviResponseText(currentText.response, currentText.text)
                    pendingQuestion =
                      currentText.response.status === "asking" ? currentText.response.question : undefined
                    if (pendingQuestion) structuredQuestionCount++
                    await Session.updatePart(currentText)
                  }
                  currentText = undefined
                  break


                case "finish":
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) break
            }

            if (pendingQuestion) {
              try {
                if (policy.maxQuestions && structuredQuestionCount > policy.maxQuestions) {
                  blocked = shouldBreak
                  pendingQuestion = undefined
                  SessionStatus.set(input.sessionID, {
                    type: "busy",
                    phase: "blocked",
                    taskClass,
                    activeAgents: [streamInput.agent.name],
                    blockedReason: "question limit exceeded",
                    nextAction: "continue only after user steering",
                  })
                } else {
                  SessionStatus.set(input.sessionID, {
                    type: "busy",
                    phase: "waiting",
                    taskClass,
                    activeAgents: [streamInput.agent.name],
                    blockedReason: "waiting for user answer",
                    nextAction: pendingQuestion.expectedNextStep,
                  })
                  const answers = await Question.ask({
                    sessionID: input.sessionID,
                    questions: [responseQuestionToPrompt(pendingQuestion)],
                  })
                  await createQuestionReplyMessage({
                    sessionID: input.sessionID,
                    assistantMessage: input.assistantMessage,
                    question: pendingQuestion,
                    answers,
                  })
                }
              } catch (error) {
                if (error instanceof Question.RejectedError) {
                  blocked = shouldBreak
                } else {
                  throw error
                }
              }
            }
          } catch (e: any) {
            log.error("process", {
              error: e,
              stack: JSON.stringify(e.stack),
            })
            const error = MessageV2.fromError(e, { providerID: input.model.providerID })
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined && attempt < maxRetries) {
              attempt++
              const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
              SessionStatus.set(input.sessionID, {
                type: "retry",
                attempt,
                message: retry,
                next: Date.now() + delay,
                phase: "retrying",
                taskClass,
                activeAgents: [streamInput.agent.name],
                nextAction: `retry in ${Math.ceil(delay / 1000)}s`,
              })
              await SessionRetry.sleep(delay, input.abort).catch(() => { })
              continue
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
          }
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) {
              await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            snapshot = undefined
          }
          const p = await MessageV2.parts(input.assistantMessage.id)
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
          }
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)
          const step = countCompletedAssistantTurns(await Session.messages({ sessionID: input.sessionID, limit: 20 }))
          await SessionTrace.record(input.sessionID, {
            type: "turn.finish",
            step,
            agent: streamInput.agent.name,
            agentVersion: streamInput.agent.version,
            promptHash: streamInput.agent.prompt ? Bun.hash.xxHash32(streamInput.agent.prompt).toString(16) : undefined,
            taskClass,
            finish: input.assistantMessage.finish,
            toolCalls: toolCallCount,
            questionCount: structuredQuestionCount,
            cost: input.assistantMessage.cost,
            error: getErrorMessage(input.assistantMessage.error),
            responseKind: lastResponse?.kind,
            responseConfidence: lastResponse?.confidence,
            responseSources: lastResponse?.sources?.slice(0, 8),
            responseNextStep: lastResponse?.nextStep,
            responseBlockedReason: lastResponse?.blockedReason,
            responseHandoff: lastResponse?.handoff,
          })
          await AgentScorecard.record({
            taskClass,
            agentName: streamInput.agent.name,
            success: !input.assistantMessage.error,
            latencyMs:
              (input.assistantMessage.time.completed ?? Date.now()) - input.assistantMessage.time.created,
            cost: input.assistantMessage.cost,
            toolCalls: toolCallCount,
            questionCount: structuredQuestionCount,
          })
          await ProviderReliability.record({
            providerID: input.model.providerID,
            modelID: input.model.id,
            success: !input.assistantMessage.error,
            latencyMs:
              (input.assistantMessage.time.completed ?? Date.now()) - input.assistantMessage.time.created,
            cost: input.assistantMessage.cost,
          })
          await EvalFramework.recordTurn({
            sessionID: input.sessionID,
            taskClass,
            step,
            agent: streamInput.agent.name,
            requestedModel: `${streamInput.user.model.providerID}/${streamInput.user.model.modelID}`,
            routedModel: `${input.model.providerID}/${input.model.id}`,
            toolCalls: toolCallCount,
            questionCount: structuredQuestionCount,
            cost: input.assistantMessage.cost,
            finish: input.assistantMessage.finish,
            error: getErrorMessage(input.assistantMessage.error),
            routingReasons: streamInput.routingReasons,
            responseKind: lastResponse?.kind,
            responseConfidence: lastResponse?.confidence,
            responseSources: lastResponse?.sources,
            responseNextStep: lastResponse?.nextStep,
            responseBlockedReason: lastResponse?.blockedReason,
            responseHandoff: lastResponse?.handoff,
            policy: {
              maxIterations: policy.maxIterations,
              maxToolCalls: policy.maxToolCalls,
              maxQuestions: policy.maxQuestions,
              maxRetries: policy.maxRetries,
              maxDelegations: policy.maxDelegations,
            },
          })
          if (taskClass === "researcher" || taskClass === "autoresearch" || taskClass === "research" || taskClass === "browse") {
            await ResearchLedger.recordTurn({
              sessionID: input.sessionID,
              taskClass,
              agent: streamInput.agent.name,
              summary: lastResponse?.summary ?? lastResponse?.answer?.slice(0, 400) ?? "",
              sources: lastResponse?.sources ?? [],
              confidence: lastResponse?.confidence,
              kind: lastResponse?.kind,
              nextStep: lastResponse?.nextStep,
              blockedReason: lastResponse?.blockedReason,
            })
          }
          if (needsCompaction) return "compact"
          if (blocked) return "stop"
          if (input.assistantMessage.error) return "stop"
          return "continue"
        }
      },
    }
    return result
  }

  function responseQuestionToPrompt(question: ResponseQuestion): Question.Info {
    return {
      question: question.text,
      header: buildQuestionHeader(question.text),
      options: (question.options ?? []).map((option) => ({
        label: option.label,
        description: option.description ?? option.value ?? option.label,
      })),
      why: question.why,
      recommendedOption: question.recommendedOption,
      impact: question.impact,
      expectedNextStep: question.expectedNextStep,
    }
  }

  function buildQuestionHeader(text: string) {
    const normalized = text
      .replace(/[^a-z0-9 ]/gi, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(" ")

    if (!normalized) return "Question"
    return normalized.slice(0, 12)
  }

  function formatQuestionReply(question: ResponseQuestion, answers: Question.Answer[]) {
    const answer = answers[0] ?? []
    const rendered = answer.length ? answer.join(", ") : "(unanswered)"
    return [
      "The user answered your question.",
      `Question: ${question.text}`,
      question.why ? `Why: ${question.why}` : "",
      question.impact ? `Impact: ${question.impact}` : "",
      question.expectedNextStep ? `Expected next step: ${question.expectedNextStep}` : "",
      question.recommendedOption ? `Recommended option: ${question.recommendedOption}` : "",
      `Answer: ${rendered}`,
    ]
      .filter(Boolean)
      .join("\n")
  }

  async function createQuestionReplyMessage(input: {
    sessionID: string
    assistantMessage: MessageV2.Assistant
    question: ResponseQuestion
    answers: Question.Answer[]
  }) {
    const parent = await MessageV2.get({
      sessionID: input.sessionID,
      messageID: input.assistantMessage.parentID,
    })

    if (parent.info.role !== "user") {
      throw new Error("Structured question replies require a parent user message")
    }

    const message = await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "user",
      agent: parent.info.agent,
      model: parent.info.model,
      time: {
        created: Date.now(),
      },
      sessionID: input.sessionID,
    })

    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: message.id,
      sessionID: input.sessionID,
      type: "text",
      text: formatQuestionReply(input.question, input.answers),
      time: {
        start: Date.now(),
        end: Date.now(),
      },
    })
    await Session.touch(input.sessionID)
  }

  function countCompletedAssistantTurns(messages: MessageV2.WithParts[]) {
    return messages.filter((message) => message.info.role === "assistant").length + 1
  }

  async function resolveTaskClass(sessionID: string, fallback: string) {
    const session = await Session.get(sessionID).catch(() => undefined)
    if (!session?.parentID) return fallback

    const parentMessages = await Session.messages({ sessionID: session.parentID }).catch(() => [])
    const parentAssistant = parentMessages.findLast((msg) => msg.info.role === "assistant")?.info as
      | MessageV2.Assistant
      | undefined
    return parentAssistant?.agent ?? fallback
  }

  function phaseForTaskClass(taskClass: string) {
    if (taskClass === "researcher" || taskClass === "autoresearch") return "researching"
    if (taskClass === "review") return "reviewing"
    if (taskClass === "qa" || taskClass === "qa-only") return "qa"
    if (taskClass === "vibemode") return "planning"
    if (taskClass === "debug") return "planning"
    return "running"
  }
}
