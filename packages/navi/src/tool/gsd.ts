import { $ } from "bun"
import { Tool } from "./tool"
import z from "zod"
import { ParallelAgent } from "../agent/parallel"
import { Agent } from "../agent/agent"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"
import { MessageID } from "../session/schema"
import { ProviderID, ModelID } from "../provider/schema"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import fs from "fs/promises"
import path from "path"
import { SymbolCache } from "../util/symbol-cache"
import type { SymbolInfo } from "../util/symbol-cache"
import { renderSymbolIndex } from "../agent/codebase-map"
import { Log } from "../util/log"

const log = Log.create({ service: "tool.gsd" })

/**
 * GSD-style Codebase Mapping Tool
 */
const mapCodebaseParameters = z.object({
    thoroughness: z.enum(["quick", "medium", "thorough"]).default("medium").describe("The level of thoroughness for exploration"),
})

export const MapCodebaseTool = Tool.define("map_codebase", async (ctx) => {
    return {
        description: "Automatically map the codebase by spawning specialized analysis agents. Generates staged STACK.md, ARCHITECTURE.md, CODEBASE_MAP.md, SYMBOL_INDEX.md, and CHANGED_FILES.md artifacts in .planning/codebase/.",
        parameters: mapCodebaseParameters,
        async execute(params: z.infer<typeof mapCodebaseParameters>, ctx) {
            const config = await Config.get()
            const planningDir = path.join(process.cwd(), ".planning", "codebase")
            await fs.mkdir(planningDir, { recursive: true })
            const stageGuidance = params.thoroughness === "quick"
                ? "Keep the scope tight: focus on the highest-signal files and the minimum map needed to orient another agent."
                : params.thoroughness === "thorough"
                    ? "Work domain-by-domain, gather detailed evidence, and include the strongest hotspots and issue-localization clues."
                    : "Use a staged pass: overview first, then architecture, then symbols, then hotspots."
            const maxConcurrent = params.thoroughness === "quick" ? 2 : params.thoroughness === "thorough" ? 2 : 3

            const tasks = [
                { agent: "explore", prompt: `Analyze the high-level project structure and technology stack in stages. Start with the top-level layout, then the main runtime surface, then the supporting utilities. Identify core languages, frameworks, and tools used. ${stageGuidance} Output your findings as a markdown file named STACK.md.` },
                { agent: "investigator", prompt: `Analyze the architectural patterns and system design in stages. First map the top-level directories, then the runtime entrypoints, then the most important data flows and module boundaries. Use local git status/diff to notice recent changes that may affect the map. ${stageGuidance} Output your findings as a markdown file named ARCHITECTURE.md.` },
                { agent: "investigator", prompt: `Create a comprehensive codebase map for fast issue localization. Include important directories, key files, exported symbols, what each area is for, why it exists, and where to look first for bugs. Work in stages if the repository is large rather than trying to map everything at once. Use local git status/diff to refresh the map with recent changes. ${stageGuidance} Output your findings as a markdown file named CODEBASE_MAP.md.` },
            ]

            const executor = async (task: ParallelAgent.Task): Promise<string> => {
                const agentName = task.agentName
                const agent = await Agent.get(agentName)
                if (!agent) throw new Error(`Unknown agent: ${agentName}`)

                const session = await Session.create({
                    parentID: ctx.sessionID,
                    title: `Map Codebase: ${task.agentName} (@${agentName})`,
                    permission: PermissionNext.merge(
                        PermissionNext.fromConfig(config.permission ?? {}),
                    )
                })

                const messageID = MessageID.ascending()
                const promptParts = await SessionPrompt.resolvePromptParts(task.prompt)

                const result = await SessionPrompt.prompt({
                    messageID,
                    sessionID: session.id,
                    model: agent.model ? {
                        modelID: ModelID.make(agent.model.modelID),
                        providerID: ProviderID.make(agent.model.providerID),
                    } : undefined,
                    agent: agentName,
                    parts: promptParts,
                })

                const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

                // Extract filename from prompt and write result
                const filenameMatch = task.prompt.match(/named ([\w\.]+)\./)
                if (filenameMatch) {
                    const filename = filenameMatch[1]
                    await fs.writeFile(path.join(planningDir, filename), text)
                }

                return text
            }

            const { results, aggregated } = await ParallelAgent.runParallel(
                tasks,
                executor,
                { maxConcurrent }
            )

            try {
                await SymbolCache.update()
            } catch (error) {
                log.warn("symbol cache update failed", { error })
            }

            let symbols: SymbolInfo[] = []
            try {
              symbols = await SymbolCache.getSymbols()
            } catch (error) {
              log.warn("symbol cache read failed", { error })
            }

            const symbolIndex = renderSymbolIndex(symbols, process.cwd())
            await fs.writeFile(path.join(planningDir, "SYMBOL_INDEX.md"), symbolIndex)
            const changedFiles = await collectChangedFiles(process.cwd())
            await fs.writeFile(path.join(planningDir, "CHANGED_FILES.md"), renderChangedFiles(changedFiles))

            return {
                title: "Codebase Mapping Complete",
                output: `Codebase mapping completed. Files generated in .planning/codebase/:\n- STACK.md\n- ARCHITECTURE.md\n- CODEBASE_MAP.md\n- SYMBOL_INDEX.md\n- CHANGED_FILES.md\n\nSummary of findings:\n${aggregated}\n\nGit snapshot:\n${changedFiles.length ? changedFiles.map((file) => `- ${file}`).join("\n") : "- No local git changes detected."}`,
                metadata: { results, changedFiles }
            }
        }
    }
})

/**
 * GSD-style Planning Tool
 */
const planPhaseParameters = z.object({
    phase_name: z.string().describe("Name of the phase (e.g. INITIAL-SETUP)"),
    objective: z.string().describe("High-level objective of this phase"),
    tasks: z.array(z.string()).describe("List of atomic tasks for this phase"),
})

export const PlanPhaseTool = Tool.define("plan_phase", async (ctx) => {
    return {
        description: "Generate an atomic, versioned plan file under .planning/phases/ using GSD's XML schema.",
        parameters: planPhaseParameters,
        async execute(params: z.infer<typeof planPhaseParameters>, ctx) {
            const phasesDir = path.join(process.cwd(), ".planning", "phases")
            await fs.mkdir(phasesDir, { recursive: true })

            // Find next phase number
            const files = await fs.readdir(phasesDir).catch(() => [])
            const phaseNum = (files.filter(f => f.endsWith(".md")).length + 1).toString().padStart(2, '0')
            const filename = `${phaseNum}-01-${params.phase_name.toUpperCase()}.md`

            let content = `# PLAN: ${params.phase_name}\n\n`
            content += `## Objective\n${params.objective}\n\n`
            content += `## Tasks\n`
            params.tasks.forEach((task, i) => {
                const taskId = (i + 1).toString().padStart(2, '0')
                content += `<task id="${taskId}">\n`
                content += `  <name>${task}</name>\n`
                content += `  <status>pending</status>\n`
                content += `</task>\n`
            })

            await fs.writeFile(path.join(phasesDir, filename), content)

            return {
                title: `Plan Created: ${filename}`,
                output: `Created plan file: .planning/phases/${filename}`,
                metadata: { filename, path: path.join(phasesDir, filename) }
            }
        }
    }
})

async function collectChangedFiles(root: string) {
    try {
        const output = await $`git status --porcelain=v1 --untracked-files=all`.cwd(root).nothrow().quiet().text()
        return output
            .split(/\r?\n/)
            .map((line) => line.slice(3).trim())
            .filter(Boolean)
    } catch (error) {
        log.warn("failed to collect changed files", { root, error })
        return []
    }
}

function renderChangedFiles(files: string[]) {
    const lines = ["# Changed Files Snapshot", ""]
    if (!files.length) {
        lines.push("No local git changes detected.")
        lines.push("")
        return lines.join("\n")
    }
    lines.push("These files changed in the current working tree and should be reflected in the next map refresh.")
    lines.push("")
    for (const file of files) {
        lines.push(`- ${file}`)
    }
    lines.push("")
    return lines.join("\n")
}

/**
 * GSD-style Execution Tool
 */
const executePhaseParameters = z.object({
    phase_file: z.string().describe("Path to the phase file to execute"),
})

export const ExecutePhaseTool = Tool.define("execute_phase", async (ctx) => {
    return {
        description: "Execute all tasks in a phase file, grouping by waves and committing each task atomically.",
        parameters: executePhaseParameters,
        async execute(params: z.infer<typeof executePhaseParameters>, ctx) {
            const filePath = path.isAbsolute(params.phase_file)
                ? params.phase_file
                : path.join(process.cwd(), params.phase_file)

            let content = await fs.readFile(filePath, "utf-8")

            // Parse waves and tasks
            const waveRegex = /<wave>(.*?)<\/wave>/gs
            let waveMatch
            const waves = []

            while ((waveMatch = waveRegex.exec(content)) !== null) {
                const waveContent = waveMatch[1]
                const taskRegex = /<task id="(\d+)">\s*<name>(.*?)<\/name>\s*<status>(.*?)<\/status>/gs
                const tasks = []
                let taskMatch
                while ((taskMatch = taskRegex.exec(waveContent)) !== null) {
                    if (taskMatch[3] === "pending") {
                        tasks.push({ id: taskMatch[1], name: taskMatch[2] })
                    }
                }
                if (tasks.length > 0) {
                    waves.push(tasks)
                }
            }

            // If no waves found, try parsing tasks directly (fallback)
            if (waves.length === 0) {
                const taskRegex = /<task id="(\d+)">\s*<name>(.*?)<\/name>\s*<status>(.*?)<\/status>/gs
                const tasks = []
                let taskMatch
                while ((taskMatch = taskRegex.exec(content)) !== null) {
                    if (taskMatch[3] === "pending") {
                        tasks.push({ id: taskMatch[1], name: taskMatch[2] })
                    }
                }
                if (tasks.length > 0) {
                    waves.push(tasks)
                }
            }

            if (waves.length === 0) {
                return { title: "No pending tasks", output: "All tasks in this phase are already completed or cancelled.", metadata: { results: undefined as any } }
            }

            const results = []
            for (const wave of waves) {
                const waveResults = []
                for (const task of wave) {
                    const agentName = "general"
                    const agent = await Agent.get(agentName)
                    if (!agent) throw new Error(`Unknown agent: ${agentName}`)

                    const session = await Session.create({
                        parentID: ctx.sessionID,
                        title: `Executing Task ${task.id}: ${task.name}`,
                    })

                    const messageID = MessageID.ascending()
                    const result = await SessionPrompt.prompt({
                        messageID,
                        sessionID: session.id,
                        agent: agentName,
                        parts: [{ type: "text", text: `Execute the following task: ${task.name}. When finished, if successful, provide a summary of your changes.` }]
                    })

                    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

                    // Update task status in file
                    content = content.replace(
                        new RegExp(`<task id="${task.id}">\\s*<name>${task.name}</name>\\s*<status>pending</status>`, 's'),
                        `<task id="${task.id}">\n  <name>${task.name}</name>\n  <status>completed</status>`
                    )
                    await fs.writeFile(filePath, content)

                    // Atomic commit
                    try {
                        const { execSync } = require("child_process")
                        execSync(`git add . && git commit -m "feat: ${task.name}"`, { stdio: 'ignore' })
                    } catch (error) {
                        log.warn("atomic commit failed", { task: task.name, error })
                    }

                    waveResults.push({ task: task.name, result: text })
                }
                results.push(...waveResults)
            }

            return {
                title: "Phase Execution Complete",
                output: `Executed ${results.length} tasks from ${params.phase_file}.`,
                metadata: { results }
            }
        }
    }
})

/**
 * GSD-style State Tracker Tool
 */
const stateTrackerParameters = z.object({
    status: z.string().optional().describe("Update the current status"),
    accomplishment: z.string().optional().describe("Add a recent accomplishment"),
    blocker: z.string().optional().describe("Add a blocker"),
    next_step: z.string().optional().describe("Add a next step"),
})

export const StateTrackerTool = Tool.define("state_tracker", async (ctx) => {
    return {
        description: "Update the project state in specs/state.md (flat file structure). Creates the file if it doesn't exist.",
        parameters: stateTrackerParameters,
        async execute(params: z.infer<typeof stateTrackerParameters>, ctx) {
            const stateFile = path.join(process.cwd(), "specs", "state.md")
            
            // Create default state file if it doesn't exist
            let content: string
            try {
                content = await fs.readFile(stateFile, "utf-8")
            } catch (e) {
                log.warn("failed to read state file", { stateFile, error: e })
                content = `# Project State

## Current Status
- **Active Task**: Initial setup

## Recent Accomplishments
- Project initialized

## Blockers
- None currently identified.

## Next Steps
1. Define requirements

---
*Last updated: ${new Date().toISOString()}*
`
                await fs.mkdir(path.join(process.cwd(), "specs"), { recursive: true })
            }

            if (params.status) {
                content = content.replace(/- \*\*Active Task\*\*: .*/, `- **Active Task**: ${params.status}`)
            }
            if (params.accomplishment) {
                content = content.replace(/## Recent Accomplishments\n/, `## Recent Accomplishments\n    - ${params.accomplishment}\n`)
            }
            if (params.blocker) {
                if (content.includes("- None currently identified.")) {
                    content = content.replace(/- None currently identified./, `- ${params.blocker}`)
                } else {
                    content = content.replace(/## Blockers\n/, `## Blockers\n- ${params.blocker}\n`)
                }
            }
            if (params.next_step) {
                content = content.replace(/## Next Steps\n/, `## Next Steps\n1. ${params.next_step}\n`)
            }

            await fs.writeFile(stateFile, content)

            return {
                title: "State Updated",
                output: "Updated specs/state.md",
                metadata: { params }
            }
        }
    }
})

/**
 * GSD-style Todo Tool
 */
const todoParameters = z.object({
    action: z.enum(["add", "list", "check", "remove"]),
    content: z.string().optional().describe("Content of the todo item"),
    id: z.string().optional().describe("ID of the todo item to check/remove"),
    category: z.string().optional().describe("Category of the todo item"),
})

export const GsdTodoTool = Tool.define("gsd_todo", async (ctx) => {
    return {
        description: "Manage project-wide todos in .planning/todos/TODO.md.",
        parameters: todoParameters,
        async execute(params: z.infer<typeof todoParameters>, ctx) {
            const todoDir = path.join(process.cwd(), ".planning", "todos")
            await fs.mkdir(todoDir, { recursive: true })
            const todoFile = path.join(todoDir, "TODO.md")

            let content = ""
            try {
                content = await fs.readFile(todoFile, "utf-8")
            } catch (e) {
                log.warn("failed to read todo file", { todoFile, error: e })
                content = "# PROJECT TODOS\n\n"
            }

            if (params.action === "add") {
                if (!params.content) throw new Error("Content is required for adding a todo")
                const id = Identifier.ascending("checkpoint")
                content += `- [ ] ${params.content} (id: ${id}) [${params.category ?? "general"}]\n`
                await fs.writeFile(todoFile, content)
                return { title: "Todo Added", output: `Added todo: ${params.content} (id: ${id})`, metadata: { id } as { id: string | undefined } }
            }

            if (params.action === "list") {
                return { title: "Todo List", output: content, metadata: { id: undefined as any } }
            }

            if (params.action === "check") {
                if (!params.id) throw new Error("ID is required for checking a todo")
                content = content.replace(new RegExp(`- \\[ \\] (.*?) \\(id: ${params.id}\\)`), `- [x] $1 (id: ${params.id})`)
                await fs.writeFile(todoFile, content)
                return { title: "Todo Checked", output: `Checked todo: ${params.id}`, metadata: { id: undefined as any } }
            }

            if (params.action === "remove") {
                if (!params.id) throw new Error("ID is required for removing a todo")
                content = content.split("\n").filter(line => !line.includes(`(id: ${params.id})`)).join("\n")
                await fs.writeFile(todoFile, content)
                return { title: "Todo Removed", output: `Removed todo: ${params.id}`, metadata: { id: undefined as any } }
            }

            return { title: "Invalid Action", output: "Invalid action for gsd_todo", metadata: { id: undefined as any } }
        }
    }
})

/**
 * GSD-style Quick Mode Tool
 */
const quickTaskParameters = z.object({
    task: z.string().describe("The small task to perform"),
})

export const QuickTaskTool = Tool.define("quick_task", async (ctx) => {
    return {
        description: "Perform a quick task with atomic commit and state tracking, skipping research/verification.",
        parameters: quickTaskParameters,
        async execute(params: z.infer<typeof quickTaskParameters>, ctx) {
            const agentName = "general"
            const agent = await Agent.get(agentName)
            if (!agent) throw new Error(`Unknown agent: ${agentName}`)

            const session = await Session.create({
                parentID: ctx.sessionID,
                title: `Quick Task: ${params.task}`,
            })

            const messageID = MessageID.ascending()
            const result = await SessionPrompt.prompt({
                messageID,
                sessionID: session.id,
                agent: agentName,
                parts: [{ type: "text", text: `Quickly perform this task: ${params.task}. No research needed.` }]
            })

            const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

            // Atomic commit
            try {
                const { execSync } = require("child_process")
                execSync(`git add . && git commit -m "feat(quick): ${params.task}"`, { stdio: 'ignore' })
            } catch (e) {
                log.warn("quick task commit failed", { task: params.task, error: e })
            }

            return {
                title: "Quick Task Complete",
                output: `Quick task completed and committed: ${params.task}\n\n${text}`,
                metadata: { result: text }
            }
        }
    }
})


