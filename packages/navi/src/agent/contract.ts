import { PermissionNext } from "@/permission/next"
import type { AgentInfo } from "./info"

export interface AgentContract {
  allowedActions: string[]
  successCriteria: string[]
  expectedOutputShape: string[]
  escalationRules: string[]
}

const INSPECTION_TOOLS = ["read", "list", "glob", "grep", "codesearch", "investigate", "map_codebase"]
const WRITE_TOOLS = ["write", "edit", "patch", "multiedit"]
const EXECUTION_TOOLS = ["bash"]
const DELEGATION_TOOLS = ["agent", "subagent", "parallel", "swarm", "consensus"]
const WEB_TOOLS = ["websearch", "webfetch", "browser_action"]
const QUESTION_TOOLS = ["question"]

const MAPPING_AGENTS = new Set(["explore", "investigator", "researcher", "autoresearch", "surfer", "browse"])
const IMPLEMENTATION_AGENTS = new Set(["coding", "backend", "frontend", "mobile", "devops", "database", "refactor", "debug", "automator"])
const VERIFICATION_AGENTS = new Set(["review", "security", "pentester", "qa", "qa-only", "tester", "performance"])
const RESEARCH_AGENTS = new Set(["researcher", "autoresearch", "surfer", "browse", "investigator", "explore"])

function enabledTools(permission: PermissionNext.Ruleset, tools: string[]) {
  return tools.filter((tool) => PermissionNext.evaluate(tool, "*", permission).action !== "deny")
}

function groupAction(permission: PermissionNext.Ruleset, label: string, tools: string[]) {
  const enabled = enabledTools(permission, tools)
  if (!enabled.length) return null
  return `${label}: ${enabled.join(", ")}`
}

function isAskable(permission: PermissionNext.Ruleset, tools: string[]) {
  return tools.some((tool) => PermissionNext.evaluate(tool, "*", permission).action === "ask")
}

export function buildAgentContract(agent: Pick<AgentInfo, "name" | "mode" | "permission" | "description">): AgentContract {
  const allowedActions: string[] = []

  const inspect = groupAction(agent.permission, "Inspect the codebase", INSPECTION_TOOLS)
  if (inspect) allowedActions.push(inspect)

  const write = groupAction(agent.permission, "Modify files", WRITE_TOOLS)
  if (write) {
    allowedActions.push(`${write}${isAskable(agent.permission, WRITE_TOOLS) ? " (ask before changing anything outside the task scope)" : ""}`)
  }

  const execute = groupAction(agent.permission, "Run shell commands", EXECUTION_TOOLS)
  if (execute) {
    allowedActions.push(`${execute}${isAskable(agent.permission, EXECUTION_TOOLS) ? " (use read-only inspection commands unless explicitly approved)" : ""}`)
  }

  const delegate = groupAction(agent.permission, "Delegate work", DELEGATION_TOOLS)
  if (delegate) allowedActions.push(delegate)

  const web = groupAction(agent.permission, "Research externally", WEB_TOOLS)
  if (web) allowedActions.push(web)

  const question = groupAction(agent.permission, "Ask the user", QUESTION_TOOLS)
  if (question) allowedActions.push(question)

  const successCriteria = buildSuccessCriteria(agent.name)
  const expectedOutputShape = buildExpectedOutputShape(agent.name)
  const escalationRules = buildEscalationRules(agent.name)

  return {
    allowedActions,
    successCriteria,
    expectedOutputShape,
    escalationRules,
  }
}

export function renderSubagentContractSection(agentName: string, contract: AgentContract) {
  const lines: string[] = []
  lines.push("## Subagent Contract")
  lines.push("")
  lines.push(`### Allowed Actions`)
  for (const item of contract.allowedActions) {
    lines.push(`- ${item}`)
  }
  lines.push("")
  lines.push(`### Success Criteria`)
  for (const item of contract.successCriteria) {
    lines.push(`- ${item}`)
  }
  lines.push("")
  lines.push(`### Expected Output Shape`)
  for (const item of contract.expectedOutputShape) {
    lines.push(`- ${item}`)
  }
  lines.push("")
  lines.push(`### Escalation Rules`)
  for (const item of contract.escalationRules) {
    lines.push(`- ${item}`)
  }
  lines.push("")
  lines.push(`Contract owner: ${agentName}`)
  lines.push("")
  return lines.join("\n")
}

function buildSuccessCriteria(agentName: string) {
  if (MAPPING_AGENTS.has(agentName)) {
    return [
      "Produce a reusable map with file paths, symbols, entrypoints, and directory purpose.",
      "Stage the work on large repositories so each pass adds new signal instead of repeating the same scan.",
      "Call out the most likely files to inspect next and the confidence of each guess.",
    ]
  }

  if (IMPLEMENTATION_AGENTS.has(agentName)) {
    return [
      "Make the smallest correct change that solves the task.",
      "Keep the implementation aligned with the existing architecture and report the exact files changed.",
      "Include the verification performed or the next verification required.",
    ]
  }

  if (VERIFICATION_AGENTS.has(agentName)) {
    return [
      "Return concrete findings, severity, and evidence instead of vague opinions.",
      "Explain how the issue was reproduced or why a claim is uncertain.",
      "Recommend the next validation step or the minimal fix path.",
    ]
  }

  if (RESEARCH_AGENTS.has(agentName)) {
    return [
      "Return evidence-backed findings with the strongest available sources or code references.",
      "Separate facts, inferences, and open questions.",
      "Use staged analysis when the repository or topic is large.",
    ]
  }

  return [
    "Complete the delegated task without expanding the scope.",
    "Return a concise summary, supporting evidence, and any blockers.",
    "Stop when the result is actionable for the next agent or the user.",
  ]
}

function buildExpectedOutputShape(agentName: string) {
  if (MAPPING_AGENTS.has(agentName)) {
    return [
      "Summary of the map goal and the most important repository areas.",
      "Directory-by-directory lookup with file purpose and key symbols.",
      "Hotspots, likely bug locations, and the next files to inspect.",
      "Gaps, uncertainty, and what would need a deeper pass.",
    ]
  }

  if (IMPLEMENTATION_AGENTS.has(agentName)) {
    return [
      "What changed and why.",
      "Exact files touched and the behavior affected.",
      "Tests or validation performed.",
      "Remaining risks or follow-up work.",
    ]
  }

  if (VERIFICATION_AGENTS.has(agentName)) {
    return [
      "Findings ordered by severity.",
      "Evidence or reproduction steps.",
      "A concrete recommendation or fix path.",
    ]
  }

  if (RESEARCH_AGENTS.has(agentName)) {
    return [
      "Direct answer first.",
      "Evidence, citations, or code references second.",
      "Open questions and confidence level last.",
    ]
  }

  return [
    "Direct answer or result first.",
    "Supporting evidence or code references.",
    "Remaining gaps or next actions.",
  ]
}

function buildEscalationRules(agentName: string) {
  const rules = [
    "Ask the user when the task requires a permission that is denied or ambiguous.",
    "Stop and report uncertainty rather than guessing when the evidence does not support a conclusion.",
  ]

  if (MAPPING_AGENTS.has(agentName)) {
    rules.push("Split large repositories into staged passes instead of attempting a full map in one shot.")
    rules.push("Refresh the map after a meaningful working-tree change before continuing.")
  }

  if (IMPLEMENTATION_AGENTS.has(agentName)) {
    rules.push("Escalate when the change spans multiple subsystems and the smallest safe scope is unclear.")
  }

  if (VERIFICATION_AGENTS.has(agentName)) {
    rules.push("Escalate with the exact failing evidence when the issue cannot be reproduced cleanly.")
  }

  if (RESEARCH_AGENTS.has(agentName)) {
    rules.push("Escalate when sources conflict, because contradiction should be reported rather than flattened.")
  }

  return rules
}
