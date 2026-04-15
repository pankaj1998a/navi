import { type PermissionMode } from "../permission/mode-types"

export type AgentWorkflow = "explore" | "build" | "review" | "plan" | "general" | "waterfall"

export interface AgentModeRecommendation {
  workflow: AgentWorkflow
  agent: string
  mode: PermissionMode
  confidence: number
  reason: string
  signals: string[]
}

export type PromptTaskLike = {
  input?: string
  parts?: Array<{
    type?: string
    text?: string
  }>
}

const READ_ONLY_TASK = /\b(read|view|inspect|explain|summarize|search|find|compare|research|investigate|analyze|understand)\b/i
const BUILD_TASK = /\b(implement|build|edit|write|fix|patch|modify|change|add|create|refactor|update)\b/i
const REVIEW_TASK = /\b(review|test|verify|qa|check|audit|debug|validate|regression)\b/i
const PLAN_TASK = /\b(plan|strategy|architecture|roadmap|design|brainstorm)\b/i
const BATCH_TASK = /\b(batch|bulk|multiple|several|many|all|automate|apply.*all|across)\b/i
const FRONTEND_TASK = /\b(frontend|ui|ux|visual|layout|style|responsive|css|html|react|component)\b/i
const BACKEND_TASK = /\b(backend|api|endpoint|database|schema|migration|server|service)\b/i
const RESEARCH_TASK = /\b(research|investigate|analyze|explore|discover|trace|map)\b/i
const COMPLEX_APP_TASK = /\b(app|application|system|platform|full-stack|microservice|architecture|from scratch|complex|robust|production)\b/i

function pushSignal(signals: string[], signal: string) {
  if (!signals.includes(signal)) signals.push(signal)
}

export function recommendAgentMode(input: {
  task: string
  currentAgent?: string
  currentMode?: PermissionMode
}): AgentModeRecommendation {
  const task = input.task.trim()
  const taskLower = task.toLowerCase()
  const signals: string[] = []

  let workflow: AgentWorkflow = "general"
  let agent = input.currentAgent ?? "general"
  let mode: PermissionMode = input.currentMode ?? "ask"
  let confidence = 0.45
  let reason = "No strong signal yet; keep the current setup."

  const readOnly = READ_ONLY_TASK.test(task)
  const buildsSomething = BUILD_TASK.test(task)
  const reviewsSomething = REVIEW_TASK.test(task)
  const plansSomething = PLAN_TASK.test(task)
  const batch = BATCH_TASK.test(task)

  if (readOnly && !buildsSomething) {
    workflow = "explore"
    agent = RESEARCH_TASK.test(task) ? "researcher" : "explore"
    mode = "safe"
    confidence = 0.93
    reason = "This is an inspection task. Claude would keep this in Explore mode, so Navi should use a read-only agent and Safe mode."
    pushSignal(signals, "Read-only task detected")
    pushSignal(signals, agent === "researcher" ? "Research-oriented wording detected" : "General exploration wording detected")
  } else if (reviewsSomething && !buildsSomething) {
    workflow = "review"
    agent = taskLower.includes("debug") ? "debug" : "qa"
    mode = "safe"
    confidence = 0.89
    reason = "This is a validation task. Claude would usually use a Review or QA path, so Navi should stay read-only."
    pushSignal(signals, "Verification or review wording detected")
  } else if (plansSomething && !buildsSomething) {
    workflow = "plan"
    agent = "plan"
    mode = "safe"
    confidence = 0.82
    reason = "This is a planning task. Claude's plan-first flow maps well to Navi's plan agent with Safe mode."
    pushSignal(signals, "Planning wording detected")
  } else if (buildsSomething) {
    workflow = "build"
    if (FRONTEND_TASK.test(task)) {
      agent = "frontend"
      pushSignal(signals, "Frontend or UI wording detected")
    } else if (BACKEND_TASK.test(task)) {
      agent = "backend"
      pushSignal(signals, "Backend or API wording detected")
    } else {
      agent = "build"
      pushSignal(signals, "Implementation wording detected")
    }
    mode = batch ? "allow-all" : "ask"
    confidence = batch ? 0.9 : 0.88
    reason = batch
      ? "This is a bulk implementation task. Claude would switch to a more automated coding flow, so Navi should use Execute mode."
      : "This is an implementation task. Claude's Code mode maps best to a coding agent with Ask to Edit mode."
    pushSignal(signals, batch ? "Bulk or automated wording detected" : "Single-step implementation wording detected")
    
    // Check for "Waterfall" candidates: Complex backend/system tasks that need structure
    if (BACKEND_TASK.test(task) && COMPLEX_APP_TASK.test(task)) {
      workflow = "waterfall"
      agent = "architect"
      confidence = 0.92
      reason = "This is a complex system/backend task. AutoBE-style Waterfall workflow is recommended for higher precision and successful build."
      pushSignal(signals, "Complex system/backend architecting detected")
    }
  } else {
    if (input.currentAgent) agent = input.currentAgent
    if (input.currentMode) mode = input.currentMode
    confidence = 0.5
  }

  if (agent === input.currentAgent && mode === input.currentMode) {
    reason = `Current agent and mode already fit this task. ${reason}`.trim()
  }

  return {
    workflow,
    agent,
    mode,
    confidence,
    reason,
    signals,
  }
}

export function collectPromptTaskText(input: PromptTaskLike) {
  const chunks: string[] = []

  if (input.input?.trim()) {
    chunks.push(input.input.trim())
  }

  for (const part of input.parts ?? []) {
    if (part.type !== "text") continue
    const text = part.text?.trim()
    if (text) chunks.push(text)
  }

  return chunks.join("\n").trim()
}

export function shouldInjectBuildAdvisor(recommendation: AgentModeRecommendation) {
  return recommendation.workflow !== "build" || recommendation.confidence < 0.75
}

export function formatBuildAdvisorNote(recommendation: AgentModeRecommendation, task: string) {
  const trimmedTask = task.trim().replace(/\s+/g, " ")
  const taskSummary = trimmedTask.length > 240 ? `${trimmedTask.slice(0, 240)}...` : trimmedTask || "No task text available"
  const signals = recommendation.signals.length > 0 ? recommendation.signals.join("; ") : "No strong signals"

  return [
    "Claude-style workflow hint:",
    `Task: ${taskSummary}`,
    `Recommended workflow: ${recommendation.workflow}`,
    `Recommended agent: ${recommendation.agent}`,
    `Recommended permission mode: ${recommendation.mode}`,
    `Confidence: ${Math.round(recommendation.confidence * 100)}%`,
    `Signals: ${signals}`,
    "If the task is ambiguous, ask a clarifying question or switch to a read-only workflow before editing.",
  ].join("\n")
}


