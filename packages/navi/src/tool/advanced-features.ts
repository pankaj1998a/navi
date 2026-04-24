import z from "zod"
import { Tool } from "./tool"
import {
    getAdaptiveThinkingLevel,
    suggestThinkingLevel,
    autoAdjustThinkingLevel,
    loadUserPattern,
    updateUserPattern,
    analyzeTaskComplexity,
} from "../agent/adaptive-thinking"
import { ParallelAgent } from "../agent/parallel"
import { Swarm, runSwarm, createSwarm, createSwarmTask } from "../agent/swarm"
import {
    suggestPermissionMode,
    suggestPermissionRules,
    autoSuggestPermissionMode,
} from "../permission/suggestions"
import {
    analyzeSessionForRecovery,
    createRecoveryPrompt,
    suggestRecoveryActions,
} from "../session/intelligent-recovery"
import {
    selectToolsForTask,
    suggestToolForTask,
    autoSelectTool,
} from "../agent/tool-selection"
import { MultiAgent } from "../agent/multi-agent"
import {
    generateLearningSummary,
    suggestToolFromLearning,
    learnFromTaskCompletion,
} from "../agent/learning"
import { MessageID, SessionID } from "../session/schema"

// Adaptive Thinking Tools

export const AnalyzeTaskComplexityTool = Tool.define("analyze_task_complexity", {
    description: "Analyze task complexity and get thinking level recommendation",
    parameters: z.object({
        task: z.string().describe("The task to analyze"),
        context: z.string().optional().describe("Additional context"),
    }),
    execute: async (args) => {
        const analysis = analyzeTaskComplexity(args.task, args.context)

        return {
            title: "Task Complexity Analysis",
            metadata: { score: analysis.score, recommendation: analysis.recommendation, needsSwarm: analysis.needsSwarm },
            output: `Complexity Score: ${analysis.score}/100
Recommended Thinking Level: ${analysis.recommendation}
Swarm Recommended: ${analysis.needsSwarm ? "Yes" : "No"}

Factors:
${analysis.factors.map(f => `- ${f}`).join("\n")}`,
        }
    },
})

export const GetAdaptiveThinkingTool = Tool.define("get_adaptive_thinking", {
    description: "Get adaptive thinking level for a task",
    parameters: z.object({
        task: z.string().describe("The task to get thinking level for"),
        context: z.string().optional().describe("Additional context"),
    }),
    execute: async (args) => {
        const level = getAdaptiveThinkingLevel(args.task, loadUserPattern(), args.context)

        return {
            title: "Adaptive Thinking Level",
            metadata: { level },
            output: `Recommended thinking level: ${level}
This is based on task complexity and your historical performance.`,
        }
    },
})

export const SuggestThinkingLevelTool = Tool.define("suggest_thinking_level", {
    description: "Suggest thinking level change based on task",
    parameters: z.object({
        task: z.string().describe("The current task"),
        currentLevel: z.enum(["off", "think", "max", "adaptive"]).describe("Current thinking level"),
        context: z.string().optional().describe("Additional context"),
    }),
    execute: async (args) => {
        const suggestion = suggestThinkingLevel(args.task, args.currentLevel, args.context)

        return {
            title: "Thinking Level Suggestion",
            metadata: { suggestion: suggestion.suggestion, confidence: suggestion.confidence },
            output: `Suggestion: ${suggestion.suggestion}
Reason: ${suggestion.reason}
Confidence: ${(suggestion.confidence * 100).toFixed(0)}%`,
        }
    },
})

export const AutoAdjustThinkingTool = Tool.define("auto_adjust_thinking", {
    description: "Auto-adjust thinking level based on task",
    parameters: z.object({
        task: z.string().describe("The current task"),
        currentLevel: z.enum(["off", "think", "max", "adaptive"]).describe("Current thinking level"),
        context: z.string().optional().describe("Additional context"),
    }),
    execute: async (args) => {
        const result = autoAdjustThinkingLevel(args.currentLevel, args.task, args.context)

        return {
            title: "Auto-Adjusted Thinking Level",
            metadata: { adjusted: result.adjusted },
            output: `Adjusted to: ${result.adjusted}
Reason: ${result.reason}`,
        }
    },
})

// Permission Suggestion Tools

export const SuggestPermissionModeTool = Tool.define("suggest_permission_mode", {
    description: "Suggest permission mode based on task",
    parameters: z.object({
        task: z.string().describe("The task to analyze"),
        sessionID: z.string().optional().describe("Session ID (defaults to current)"),
    }),
    execute: async (args) => {
        const sessionID = args.sessionID || "default"
        const suggestion = suggestPermissionMode(args.task, "ask", sessionID)

        if (!suggestion) {
            return {
                title: "Permission Mode Suggestion",
                metadata: { suggestion: undefined as any, confidence: undefined as any },
                output: "No suggestion needed. Current mode is optimal.",
            }
        }

        return {
            title: "Permission Mode Suggestion",
            metadata: { suggestion: suggestion.suggestion, confidence: suggestion.confidence },
            output: `Suggestion: ${suggestion.suggestion}
Reason: ${suggestion.reason}
Confidence: ${(suggestion.confidence * 100).toFixed(0)}%`,
        }
    },
})

export const SuggestPermissionRulesTool = Tool.define("suggest_permission_rules", {
    description: "Suggest custom permission rules based on usage patterns",
    parameters: z.object({
        workspaceRoot: z.string().describe("Workspace root path"),
    }),
    execute: async (args) => {
        const suggestions = suggestPermissionRules(args.workspaceRoot)

        if (suggestions.length === 0) {
            return {
                title: "Permission Rule Suggestions",
                metadata: { count: undefined as any },
                output: "No suggestions. Your permissions are well configured.",
            }
        }

        const output = suggestions.map(s =>
            `${s.type}: ${s.pattern}\n  Reason: ${s.reason}`
        ).join("\n\n")

        return {
            title: "Permission Rule Suggestions",
            metadata: { count: suggestions.length },
            output: `Found ${suggestions.length} suggestions:\n\n${output}`,
        }
    },
})

// Session Recovery Tools

export const AnalyzeSessionForRecoveryTool = Tool.define("analyze_session_for_recovery", {
    description: "Analyze session for recovery context",
    parameters: z.object({
        sessionID: z.string().describe("Session ID to analyze"),
        limit: z.number().optional().describe("Number of messages to analyze"),
    }),
    execute: async (args) => {
        // In a real implementation, this would load messages from session
        // For now, return a placeholder
        return {
            title: "Session Recovery Analysis",
            metadata: {},
            output: "Session analysis would be performed here with actual session data.",
        }
    },
})

export const GetRecoveryPromptTool = Tool.define("get_recovery_prompt", {
    description: "Get recovery prompt for continuing a session",
    parameters: z.object({
        sessionID: z.string().describe("Session ID to recover"),
    }),
    execute: async (args) => {
        // In a real implementation, this would load recovery context
        // For now, return a placeholder
        return {
            title: "Recovery Prompt",
            metadata: {},
            output: "Recovery prompt would be generated here with actual session data.",
        }
    },
})

export const SuggestRecoveryActionsTool = Tool.define("suggest_recovery_actions", {
    description: "Suggest recovery actions for a session",
    parameters: z.object({
        sessionID: z.string().describe("Session ID to analyze"),
    }),
    execute: async (args) => {
        // In a real implementation, this would analyze session
        // For now, return a placeholder
        return {
            title: "Recovery Actions",
            metadata: {},
            output: "Recovery actions would be suggested here with actual session data.",
        }
    },
})

// Tool Selection Tools

export const SelectToolsForTaskTool = Tool.define("select_tools_for_task", {
    description: "Select optimal tools for a task",
    parameters: z.object({
        task: z.string().describe("The task to analyze"),
        availableTools: z.array(z.string()).describe("List of available tools"),
    }),
    execute: async (args) => {
        const selections = selectToolsForTask(args.task, args.availableTools)

        if (selections.length === 0) {
            return {
                title: "Tool Selection",
                metadata: { count: undefined as any },
                output: "No suitable tools found for this task.",
            }
        }

        const output = selections.slice(0, 5).map(s =>
            `${s.toolId}: Priority ${s.priority}\n  Reason: ${s.reason}`
        ).join("\n\n")

        return {
            title: "Tool Selection",
            metadata: { count: selections.length },
            output: `Top tools for this task:\n\n${output}`,
        }
    },
})

export const SuggestToolForTaskTool = Tool.define("suggest_tool_for_task", {
    description: "Suggest the best tool for a task",
    parameters: z.object({
        task: z.string().describe("The task to analyze"),
        availableTools: z.array(z.string()).describe("List of available tools"),
    }),
    execute: async (args) => {
        const suggestion = suggestToolForTask(args.task, args.availableTools)

        if (!suggestion) {
            return {
                title: "Tool Suggestion",
                metadata: { tool: undefined as any, confidence: undefined as any },
                output: "No tool suggestion available for this task.",
            }
        }

        return {
            title: "Tool Suggestion",
            metadata: { tool: suggestion.toolId, confidence: suggestion.confidence },
            output: `Suggested tool: ${suggestion.toolId}
Reason: ${suggestion.reason}
Confidence: ${(suggestion.confidence * 100).toFixed(0)}%`,
        }
    },
})

// Swarm Tools

export const SuggestSwarmTool = Tool.define("suggest_swarm", {
    description: "Suggest swarm collaboration for complex tasks",
    parameters: z.object({
        task: z.string().describe("The task to analyze"),
        complexity: z.number().optional().describe("Task complexity (0-100)"),
        models: z.array(z.string()).optional().describe("Models to consider for the swarm"),
    }),
    execute: async (args) => {
        const complexity = args.complexity || 50
        const suggestion = MultiAgent.analyze(args.task, complexity)

        if (!suggestion.needsCollaboration) {
            return {
                title: "Swarm Suggestion",
                metadata: { agents: [], confidence: 0 },
                output: "Task can be handled by a single agent.",
            }
        }

        return {
            title: "Swarm Suggestion",
            metadata: { agents: suggestion.suggestedAgents, confidence: complexity / 100 },
            output: `Suggestion: ${suggestion.reason}
Agents needed: ${suggestion.suggestedAgents.join(", ")}
Confidence: ${complexity.toFixed(0)}%`,
        }
    },
})

export const CreateSwarmPlanTool = Tool.define("create_swarm_plan", {
    description: "Create a swarm collaboration plan",
    parameters: z.object({
        task: z.string().describe("The task to plan"),
        agents: z.array(z.enum([
            "planner", "executor", "reviewer", "researcher", "debugger",
            "architect", "frontend", "backend", "devops", "security", "qa"
        ])).describe("Agents to use"),
        models: z.array(z.string()).optional().describe("Models to use"),
    }),
    execute: async (args) => {
        const plan = await MultiAgent.createPlan(args.task, args.agents)
        // TODO: Generate summary with models
        const summary = MultiAgent.generateSummary(plan)

        return {
            title: "Swarm Plan",
            metadata: { planId: plan.id, agentCount: plan.agents.length, models: args.models },
            output: summary,
        }
    },
})

import { AgentSystem } from "../agent/agent-system"
import { Agent } from "../agent/agent"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"

export const RunSwarmTool = Tool.define("run_swarm", {
    description: "Run a swarm of agents in parallel on a task with configurable models",
    parameters: z.object({
        task: z.string().describe("The task for the agents to perform"),
        agents: z.array(z.string()).min(2).describe("List of specialized agents to run (min 2)"),
        models: z.array(z.string()).optional().describe("Models to use for each agent"),
        strategy: z.enum(["all", "consensus", "best_of"]).default("consensus").describe("Result aggregation strategy"),
    }),
    async execute(args, ctx) {
        // Create swarm tasks with optional model assignment
        const tasks = args.agents.map((agent, index) => ({
            agent,
            prompt: args.task,
            model: args.models && args.models[index] ? args.models[index] : undefined,
        }))

        // Run the swarm using AgentSystem
        const result = await AgentSystem.run(tasks, async (task) => {
            const agent = await Agent.get(task.agentName)
            if (!agent) {
                return `Error: Agent '${task.agentName}' not found`
            }

            const session = await Session.create({
                parentID: ctx.sessionID,
                title: `Swarm: ${task.agentName}`,
            })

            const messageID = MessageID.ascending()
            const promptParts = await SessionPrompt.resolvePromptParts(task.prompt)
            const selectedModel = task.model ? Provider.parseModel(task.model) : agent.model

            const result = await SessionPrompt.prompt({
                messageID,
                sessionID: session.id,
                model: selectedModel,
                agent: agent.name,
                parts: promptParts,
            })

            const textPart = result.parts.findLast((x: any) => x.type === "text")
            const text = textPart && 'text' in textPart ? textPart.text : ""
            return text
        }, {
            mode: "swarm",
            strategy: args.strategy,
            emitPart: ctx.metadata as any
        })

        return {
            title: "Swarm Execution Complete",
            metadata: {
                agents: args.agents,
                models: args.models,
                strategy: args.strategy,
                results: result.results
            },
            output: result.aggregated,
        }
    },
})

// Learning Tools

export const GenerateLearningSummaryTool = Tool.define("generate_learning_summary", {
    description: "Generate summary of learned patterns",
    parameters: z.object({}),
    execute: async () => {
        const summary = await generateLearningSummary()

        return {
            title: "Learning Summary",
            metadata: {},
            output: summary,
        }
    },
})

export const LearnFromTaskTool = Tool.define("learn_from_task", {
    description: "Learn from task completion and feedback",
    parameters: z.object({
        task: z.string().describe("The completed task"),
        toolUsed: z.string().describe("Tool that was used"),
        success: z.boolean().describe("Whether the task succeeded"),
        feedback: z.string().optional().describe("User feedback"),
    }),
    execute: async (args) => {
        learnFromTaskCompletion(args.task, args.toolUsed, args.success, args.feedback)

        return {
            title: "Learning Complete",
            metadata: {},
            output: `Learned from task: ${args.task}
Tool: ${args.toolUsed}
Result: ${args.success ? "Success" : "Failure"}
Feedback: ${args.feedback || "None"}`,
        }
    },
})

export const SuggestToolFromLearningTool = Tool.define("suggest_tool_from_learning", {
    description: "Suggest tool based on learned patterns",
    parameters: z.object({
        task: z.string().describe("The task to analyze"),
        availableTools: z.array(z.string()).describe("List of available tools"),
    }),
    execute: async (args) => {
        const result = await suggestToolFromLearning(args.task)

        return {
            title: "Tool Suggestion from Learning",
            metadata: { tool: "unknown", confidence: 0 },
            output: result,
        }
    },
})


