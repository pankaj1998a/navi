/**
 * Avni — VibeMode Production Protocol Orchestrator
 *
 * Implements the full 7-phase protocol from vibemode.md:
 *   Phase 0: Intake & complexity classification
 *   Phase 1: Discovery (research swarm + clarification)
 *   Phase 2: Specification → .vibe/requirement.md + Gate 1
 *   Phase 3: Planning    → .vibe/plan.md          + Gate 2
 *   Phase 4: Task Decomposition → .vibe/task.md   + Gate 3
 *   Phase 5: Execution   (git-backed, per-task commits, background indexing)
 *   Phase 6: Security & Bug Audit                  + Gate 4
 *   Phase 7: Finalisation (changelog, remote push) + Gate 5
 *
 * Avni NEVER writes code directly. She commands agents, enforces gates,
 * manages git, tracks session state, and surfaces failures.
 */

import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
import { ulid } from "ulid"
import { Log } from "../util/log"
import { Mapper } from "./mapper"
import { AgentRunner, AgentConfig } from "./agent-runner"
import type { AgentResult, AgentTask, AgentType } from "./orchestrator"

const log = Log.create({ service: "avni" })

// ─── Types ────────────────────────────────────────────────────────────────────

export type VibeGate = 1 | 2 | 3 | 4 | 5

export type VibePhase =
  | { phase: 0; step: "intake" }
  | { phase: 1; step: "broad-research" | "clarification" | "deep-research" }
  | { phase: 2; step: "generate-requirement" | "gate-1" }
  | { phase: 3; step: "generate-plan" | "gate-2" }
  | { phase: 4; step: "decompose-tasks" | "gate-3" }
  | { phase: 5; step: "git-init" | "executing" | "governance" | "indexing" | "checkpoint" }
  | { phase: 6; step: "bug-sweep" | "security-audit" | "gate-4" }
  | { phase: 7; step: "changelog" | "usage-report" | "remote-push" | "gate-5" | "complete" }

export type AvniEvent =
  | { type: "status";    message: string }
  | { type: "progress";  phase: number; step: string }
  | { type: "artifact";  path: string; description: string }
  | { type: "gate";      gate: VibeGate; artifactPath: string; message: string }
  | { type: "agent-result"; agentType: string; result: AgentResult }
  | { type: "failure";   agentType: string; error: string; suggestion: string }
  | { type: "complete";  summary: string }
  | { type: "question";  question: string }  // emitted when Avni needs user input mid-flow
  | { type: "task-complete"; taskId: string; taskName: string }

export interface SessionState {
  sessionId: string
  goal: string
  phase: number
  step: string
  branch: string
  lastCommit: string
  lastCompletedTask: string
  startedAt: string
  root: string
  modelOverrides: Record<string, string>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VIBE_DIR = ".vibe"
const MAP_DIR = ".map"
const REQUIREMENT_FILE = "requirement.md"
const PLAN_FILE = "plan.md"
const TASK_FILE = "task.md"
const SECURITY_FILE = "security-audit.md"
const CHANGELOG_FILE = "changelog.md"
const USAGE_FILE = "usage.md"
const SESSION_FILE = "session.json"

// Simple complexity classifier heuristic
const COMPLEX_KEYWORDS = [
  "build", "create", "implement", "develop", "design", "app", "system",
  "api", "database", "frontend", "backend", "server", "service", "feature",
  "module", "authentication", "deploy", "refactor", "migrate"
]

// ─── Avni Orchestrator ────────────────────────────────────────────────────────

export class Avni {
  private root: string
  private runner: AgentRunner
  private session: SessionState | null = null
  private tokenUsage: Record<string, { input: number; output: number }> = {}

  constructor(root: string) {
    this.root = root
    this.runner = new AgentRunner()
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private vibePath(...segments: string[]): string {
    return path.join(this.root, VIBE_DIR, ...segments)
  }

  private async ensureVibeDir() {
    await fs.mkdir(this.vibePath(), { recursive: true })
    await fs.mkdir(path.join(this.root, MAP_DIR), { recursive: true })
  }

  private async readVibe(file: string): Promise<string | null> {
    try {
      return await fs.readFile(this.vibePath(file), "utf8")
    } catch {
      return null
    }
  }

  private async writeVibe(file: string, content: string) {
    await this.ensureVibeDir()
    await fs.writeFile(this.vibePath(file), content, "utf8")
  }

  private async saveSession(update: Partial<SessionState>) {
    this.session = { ...this.session!, ...update }
    await this.writeVibe(SESSION_FILE, JSON.stringify(this.session, null, 2))
  }

  async loadSession(): Promise<SessionState | null> {
    const raw = await this.readVibe(SESSION_FILE)
    if (!raw) return null
    try {
      this.session = JSON.parse(raw)
      return this.session
    } catch {
      return null
    }
  }

  // ── Complexity Classification ─────────────────────────────────────────────

  private classifyComplexity(goal: string): "simple" | "complex" {
    const lower = goal.toLowerCase()
    const wordCount = goal.trim().split(/\s+/).length

    // Short answers / questions → simple
    if (wordCount < 8 && !COMPLEX_KEYWORDS.some(k => lower.includes(k))) {
      return "simple"
    }
    // Structural/creative tasks → complex
    if (COMPLEX_KEYWORDS.some(k => lower.includes(k))) {
      return "complex"
    }
    return wordCount > 20 ? "complex" : "simple"
  }

  // ── Agent Invocation ──────────────────────────────────────────────────────

  private async spawnAgent(type: AgentType, description: string): Promise<AgentResult> {
    const task: AgentTask = {
      id: ulid(),
      type,
      description,
    }
    const results = await this.runner.runParallel([task])
    return results[0]
  }

  // ── Git Operations ────────────────────────────────────────────────────────

  private async gitInit(): Promise<string> {
    // Init git if not already a repo
    await $`git init`.cwd(this.root).nothrow().quiet()

    const branchName = `vibe/${Date.now()}`
    try {
      // Create and checkout a new vibe branch
      await $`git checkout -b ${branchName}`.cwd(this.root).nothrow().quiet()
    } catch {
      // branch may already exist
    }
    return branchName
  }

  private async gitCommit(message: string): Promise<string> {
    await $`git add -A`.cwd(this.root).nothrow().quiet()
    await $`git commit -m ${message} --allow-empty`.cwd(this.root).nothrow().quiet()

    const hash = await $`git rev-parse --short HEAD`.cwd(this.root).nothrow().text()
    return hash.trim()
  }

  private async gitRevert(toCommit: string) {
    await $`git revert --no-commit ${toCommit}..HEAD`.cwd(this.root).nothrow().quiet()
    await $`git checkout HEAD -- .`.cwd(this.root).nothrow().quiet()
    log.info("Avni: reverted to checkpoint", { commit: toCommit })
  }

  // ── Background Indexer ────────────────────────────────────────────────────

  private async triggerMapper() {
    try {
      log.info("Avni: triggering background mapper update")
      await Mapper.writeIndex(this.root)
      log.info("Avni: mapper update complete")
    } catch (e) {
      log.warn("Avni: mapper update failed (non-fatal)", { error: e })
    }
  }

  // ── Task.md Parser ────────────────────────────────────────────────────────

  private async markTaskComplete(taskId: string) {
    const content = await this.readVibe(TASK_FILE)
    if (!content) return
    // Replace [ ] with [x] for the specific task ID line
    const updated = content.replace(
      new RegExp(`(- \\[ \\])(.*${taskId}.*)`, "g"),
      (_, _box, rest) => `- [x]${rest}`
    )
    await this.writeVibe(TASK_FILE, updated)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main Protocol — AsyncGenerator yielding AvniEvent
  // ─────────────────────────────────────────────────────────────────────────

  async *run(goal: string): AsyncGenerator<AvniEvent> {
    await this.ensureVibeDir()

    // ── Phase 0: Intake ──────────────────────────────────────────────────

    yield { type: "progress", phase: 0, step: "intake" }
    yield { type: "status", message: `Avni received goal: "${goal}"` }

    const complexity = this.classifyComplexity(goal)

    if (complexity === "simple") {
      yield { type: "status", message: "Goal classified as simple. Providing direct response." }
      const result = await this.spawnAgent("researcher", goal)
      yield { type: "agent-result", agentType: "researcher", result }
      yield { type: "complete", summary: result.output }
      return
    }

    yield { type: "status", message: "Goal classified as complex. Initialising VibeMode Production Protocol..." }

    this.session = {
      sessionId: ulid(),
      goal,
      phase: 1,
      step: "broad-research",
      branch: "",
      lastCommit: "",
      lastCompletedTask: "",
      startedAt: new Date().toISOString(),
      root: this.root,
      modelOverrides: {},
    }
    await this.saveSession({})

    // ── Phase 1: Discovery ──────────────────────────────────────────────

    yield { type: "progress", phase: 1, step: "broad-research" }
    yield { type: "status", message: "Phase 1: Discovery — Architecting project map..." }

    // 1. Run the local Mapper tool for a baseline structural scan
    await this.triggerMapper()
    yield { type: "status", message: "✅ Local baseline map generated in .map/index.md" }

    // 2. Launch CodebaseIndexer for an intelligent semantic map
    yield { type: "status", message: "Launching CodebaseIndexer agent for semantic analysis..." }
    const indexingResult = await this.spawnAgent(
      "codebase-indexer" as AgentType,
      `Analyze the project structure and primary exports. Reference the baseline map at .map/index.md to avoid duplicate work. Focus on responsibilities and project-specific patterns.`
    )
    yield { type: "agent-result", agentType: "codebase-indexer", result: indexingResult }

    // 3. Perform broad research sweep
    yield { type: "status", message: "Performing broad research sweep for technological landscape..." }
    const broadResearch = await this.spawnAgent(
      "researcher",
      `Perform a general landscape scan for: "${goal}". Cover available frameworks, architectural patterns, database options, and known pitfalls. 
       Context from project index: .map/index.md
       Context from codebase indexer: .map/codebase-index-file.md
       
       Return a structured summary that considers the existing codebase patterns.`
    )

    if (!broadResearch.success) {
      yield { type: "failure", agentType: "researcher", error: broadResearch.error ?? "Unknown", suggestion: "Try switching the Researcher to a different model." }
    }

    yield { type: "agent-result", agentType: "researcher", result: broadResearch }


    yield { type: "progress", phase: 1, step: "clarification" }
    yield {
      type: "question",
      question: `Based on the research, I need a few clarifications before proceeding:\n\nInitial findings:\n${broadResearch.output}\n\n---\nPlease answer:\n1. What programming language / framework do you prefer?\n2. What database do you want to use?\n3. Any specific hosting or deployment constraints?\n4. Preferred scale (prototype vs production-ready)?\n\nYour answers will drive the detailed research in the next step.`
    }
    // Note: In the TUI integration, this yield pauses and waits for user response.
    // The continuation is triggered by calling Avni.continue(userAnswer)

    await this.saveSession({ phase: 1, step: "clarification" })

    // ── Phase 2: Specification ───────────────────────────────────────────

    yield { type: "progress", phase: 2, step: "generate-requirement" }
    yield { type: "status", message: "Phase 2: Generating .vibe/requirement.md..." }

    const requirementContent = `# Requirements: ${goal}

> Generated by Avni — VibeMode Production Protocol  
> Date: ${new Date().toISOString()}

## Project Goal
${goal}

## Research Summary
${broadResearch.output}

## Stack & Constraints
*(To be filled with user clarification answers)*

## Functional Requirements
*(Derived from research and user answers)*

## Non-Functional Requirements
- Performance targets
- Security requirements
- Scalability expectations

## Out of Scope
*(Explicit exclusions)*

---
*Review this file and reply with any corrections, then approve to proceed to planning.*
`

    await this.writeVibe(REQUIREMENT_FILE, requirementContent)
    yield { type: "artifact", path: this.vibePath(REQUIREMENT_FILE), description: "Requirements specification" }

    yield {
      type: "gate",
      gate: 1,
      artifactPath: this.vibePath(REQUIREMENT_FILE),
      message: `🔒 Gate 1: Please review .vibe/requirement.md.\nReply APPROVE to proceed to planning, or describe any changes needed.`
    }
    await this.saveSession({ phase: 2, step: "gate-1" })

    // ── Phase 3: Planning ────────────────────────────────────────────────

    yield { type: "progress", phase: 3, step: "generate-plan" }
    yield { type: "status", message: "Phase 3: Architect is generating the technical plan..." }

    const architectResult = await this.spawnAgent(
      "architect",
      `Read .vibe/requirement.md and produce a comprehensive technical plan covering:
1. Database schema and model design
2. File and folder structure (down to module level)
3. Framework selection rationale
4. API surface and data contracts
5. Authentication strategy and security protocols
6. Environment and deployment considerations

Reference the requirements at: ${this.vibePath(REQUIREMENT_FILE)}`
    )

    if (!architectResult.success) {
      yield { type: "failure", agentType: "architect", error: architectResult.error ?? "Unknown", suggestion: "Consider switching the Architect model." }
    }

    const planContent = `# Technical Plan: ${goal}

> Generated by Avni — Architect Agent  
> Date: ${new Date().toISOString()}

${architectResult.output}

---
*Review this plan and reply APPROVE to proceed to task decomposition.*
`

    await this.writeVibe(PLAN_FILE, planContent)
    yield { type: "artifact", path: this.vibePath(PLAN_FILE), description: "Technical architecture plan" }

    yield {
      type: "gate",
      gate: 2,
      artifactPath: this.vibePath(PLAN_FILE),
      message: `🔒 Gate 2: Please review .vibe/plan.md.\nReply APPROVE to proceed to task decomposition.`
    }
    await this.saveSession({ phase: 3, step: "gate-2" })

    // ── Phase 4: Task Decomposition ──────────────────────────────────────

    yield { type: "progress", phase: 4, step: "decompose-tasks" }
    yield { type: "status", message: "Phase 4: Decomposing plan into granular tasks..." }

    const taskResult = await this.spawnAgent(
      "planner",
      `Read .vibe/plan.md and decompose the project into a hierarchical task list.

Rules:
- Every major task has specific sub-tasks
- Each sub-task has a clear done condition
- Every task group ends with a test phase
- Tasks are ordered — each builds on verified prior work
- Use checkbox format: - [ ] TASK-ID: Description

Reference the plan at: ${this.vibePath(PLAN_FILE)}`
    )

    const taskContent = `# Task Plan: ${goal}

> Generated by Avni — Planner Agent  
> Date: ${new Date().toISOString()}
> Format: - [ ] TASK-ID: description

${taskResult.output}

---
🔸 checkpoint — Task decomposition complete
*Review this breakdown and reply APPROVE to begin coding.*
`

    await this.writeVibe(TASK_FILE, taskContent)
    yield { type: "artifact", path: this.vibePath(TASK_FILE), description: "Task breakdown with checkboxes" }

    yield {
      type: "gate",
      gate: 3,
      artifactPath: this.vibePath(TASK_FILE),
      message: `🔒 Gate 3: Please review .vibe/task.md.\nReply APPROVE to begin implementation.`
    }
    await this.saveSession({ phase: 4, step: "gate-3" })

    // ── Phase 5: Execution ───────────────────────────────────────────────

    yield { type: "progress", phase: 5, step: "git-init" }
    yield { type: "status", message: "Phase 5: Initialising local git branch..." }

    const branch = await this.gitInit()
    const initCommit = await this.gitCommit("chore: avni session start — vibe protocol initialised")
    yield { type: "status", message: `✅ Working on branch: ${branch}. Initial commit: ${initCommit}` }
    await this.saveSession({ phase: 5, step: "executing", branch, lastCommit: initCommit })

    // Initial mapper run to establish baseline
    yield { type: "status", message: "Building initial project index..." }
    await this.triggerMapper()

    // Parse tasks from task.md
    const taskMd = await this.readVibe(TASK_FILE) ?? ""
    const taskLines = taskMd
      .split("\n")
      .filter(l => /^- \[ \] (TASK-\S+|T\d+):/.test(l.trim()))

    yield { type: "status", message: `Found ${taskLines.length} tasks to execute. Beginning implementation...` }

    for (const taskLine of taskLines) {
      const match = taskLine.match(/^- \[ \] ([\w-]+): (.+)/)
      if (!match) continue
      const [, taskId, taskDesc] = match

      yield { type: "progress", phase: 5, step: "executing" }
      yield { type: "status", message: `Executing: [${taskId}] ${taskDesc}` }

      let result = await this.spawnAgent("editor", `${taskDesc}\n\nContext from project index: ${path.join(this.root, MAP_DIR, "index.md")}`)

      if (!result.success) {
        yield {
          type: "failure",
          agentType: "editor",
          error: result.error ?? "Unknown error",
          suggestion: `Task ${taskId} failed. Check the error and consider:\n1. Switching the Editor agent to a different model\n2. Reverting to last checkpoint (commit ${this.session!.lastCommit})\n3. Manually completing this sub-task`
        }
        // Revert to last known-good commit
        await this.gitRevert(this.session!.lastCommit)
        // Re-attempt once
        yield { type: "status", message: `Retrying ${taskId} from clean state...` }
        result = await this.spawnAgent("editor", taskDesc)
      }

      if (result.success) {
        // Mark complete, commit, index
        await this.markTaskComplete(taskId)
        const commit = await this.gitCommit(`feat(${taskId}): ${taskDesc.slice(0, 60)}`)
        await this.saveSession({ lastCommit: commit, lastCompletedTask: taskId })
        yield { type: "task-complete", taskId, taskName: taskDesc }

        // Background indexing
        yield { type: "progress", phase: 5, step: "indexing" }
        await this.triggerMapper()
      }
    }

    // ── Phase 6: Security & Bug Audit ────────────────────────────────────

    yield { type: "progress", phase: 6, step: "bug-sweep" }
    yield { type: "status", message: "Phase 6: Bug-Buster is scanning for logic errors..." }

    const bugResult = await this.spawnAgent("bug-buster" as AgentType, `Scan the full codebase at ${this.root} for bugs. Reference requirements at ${this.vibePath(REQUIREMENT_FILE)}`)
    yield { type: "agent-result", agentType: "bug-buster", result: bugResult }

    yield { type: "progress", phase: 6, step: "security-audit" }
    yield { type: "status", message: "Security Sentinel is running the security audit..." }

    const secResult = await this.spawnAgent("security-sentinel" as AgentType, `Perform a full security audit of the project at ${this.root}.`)
    yield { type: "agent-result", agentType: "security-sentinel", result: secResult }

    const auditCommit = await this.gitCommit("audit: security and bug sweep complete")
    await this.saveSession({ lastCommit: auditCommit })

    yield {
      type: "gate",
      gate: 4,
      artifactPath: this.vibePath(SECURITY_FILE),
      message: `🔒 Gate 4: Please review .vibe/security-audit.md.\nReply APPROVE to proceed to finalisation, or CRITICAL to fix blocking issues first.`
    }
    await this.saveSession({ phase: 6, step: "gate-4" })

    // ── Phase 7: Finalisation ────────────────────────────────────────────

    yield { type: "progress", phase: 7, step: "changelog" }
    yield { type: "status", message: "Phase 7: Doc Architect generating changelog..." }

    const changelogResult = await this.spawnAgent(
      "doc-architect" as AgentType,
      `Generate a comprehensive changelog and handover document for the project.
Goal: ${goal}
Reference: ${this.vibePath(REQUIREMENT_FILE)}, ${this.vibePath(TASK_FILE)}`
    )

    const changelogContent = `# Changelog

> Project: ${goal}  
> Completed: ${new Date().toISOString()}  
> Branch: ${this.session!.branch}

${changelogResult.output}
`
    await this.writeVibe(CHANGELOG_FILE, changelogContent)
    yield { type: "artifact", path: this.vibePath(CHANGELOG_FILE), description: "Project changelog and handover document" }

    // Token usage summary
    const usageContent = `# Token Usage Summary

> Session: ${this.session!.sessionId}  
> Completed: ${new Date().toISOString()}

| Agent | Input Tokens | Output Tokens |
|-------|-------------|---------------|
${Object.entries(this.tokenUsage).map(([a, u]) => `| ${a} | ${u.input} | ${u.output} |`).join("\n")}

*Token tracking is approximate in this version.*
`
    await this.writeVibe(USAGE_FILE, usageContent)

    const finalCommit = await this.gitCommit("docs: generate changelog and usage report")
    await this.saveSession({ lastCommit: finalCommit, phase: 7, step: "remote-push" })

    yield {
      type: "gate",
      gate: 5,
      artifactPath: this.vibePath(CHANGELOG_FILE),
      message: `🔒 Gate 5: Project is complete!\n\nReview .vibe/changelog.md for the full summary.\n\nReply PUSH to push branch '${this.session!.branch}' to remote, or DONE to keep it local.`
    }
    await this.saveSession({ phase: 7, step: "gate-5" })

    yield {
      type: "complete",
      summary: `✨ VibeMode Complete!\n\nGoal: ${goal}\nBranch: ${this.session!.branch}\nArtifacts: .vibe/ folder\n\nAll changes are committed locally. Remote push requires explicit approval.`
    }
    await this.saveSession({ phase: 7, step: "complete" })
  }

  // ── Remote Push (called after Gate 5 approval) ────────────────────────────

  async pushToRemote(remote = "origin"): Promise<void> {
    if (!this.session?.branch) throw new Error("No active session to push")
    await $`git push ${remote} ${this.session.branch}`.cwd(this.root)
    log.info("Avni: pushed branch to remote", { branch: this.session.branch, remote })
  }
}
