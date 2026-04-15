/**
 * Multi-Agent Collaboration
 *
 * Support for coordinating multiple agents to solve complex tasks.
 */

import { Log } from "../util/log";
import { type ThinkingLevel } from "./thinking-levels";
import { SharedMemory } from "./memory";
import { analyzeTaskComplexity } from "./adaptive-thinking";

const log = Log.create({ service: "multi-agent" });

export type AgentRole =
    | "planner"
    | "executor"
    | "coding"
    | "reviewer"
    | "researcher"
    | "debugger"
    | "architect"
    | "frontend"
    | "backend"
    | "devops"
    | "security"
    | "qa"
    | "analyst"
    | "automator"
    | "coach"
    | "content-creator"
    | "database"
    | "documentation"
    | "investigator"
    | "finance"
    | "lead-generator"
    | "legal"
    | "marketing"
    | "mobile"
    | "performance"
    | "product"
    | "ralph"
    | "real-estate"
    | "refactor"
    | "sales"
    | "social"
    | "support"
    | "surfer"
    | "tester"
    | "travel-agent"
    | "ux-researcher"
    | "visual-storyteller"
    | "youtube-agent"
    | "refactor"
    | "sales"
    | "social"
    | "support"
    | "surfer"
    | "tester"
    | "travel-agent"
    | "ux-researcher"
    | "visual-storyteller"
    | "youtube-agent";

/**
 * Agent specification
 */
export interface AgentSpec {
    id: string;
    role: AgentRole;
    thinkingLevel: ThinkingLevel;
    capabilities: string[];
    tools: string[];
}

/**
 * Collaboration task
 */
export interface CollaborationTask {
    id: string;
    description: string;
    subtasks: Subtask[];
    agents: AgentSpec[];
    coordinator: string;
    status: "pending" | "in-progress" | "completed" | "failed";
}

/**
 * Subtask for delegation
 */
export interface Subtask {
    id: string;
    description: string;
    assignedTo: string;
    dependencies: string[];
    status: "pending" | "in-progress" | "completed" | "failed";
    result?: string;
}

export namespace MultiAgent {
    /**
     * Analyze task for multi-agent collaboration
     */
    export function analyze(
        taskDescription: string,
        complexity: number
    ): { needsCollaboration: boolean; reason: string; suggestedAgents: AgentRole[] } {
        const taskLower = taskDescription.toLowerCase();

        // Check for indicators of complex tasks
        const indicators: { pattern: RegExp; agents: AgentRole[] }[] = [
            { pattern: /multiple.*components|modules|parts/, agents: ["planner", "executor", "reviewer"] },
            { pattern: /research.*and.*implement/, agents: ["researcher", "executor"] },
            { pattern: /debug.*complex|investigate.*issue/, agents: ["debugger", "researcher"] },
            { pattern: /investigate.*codebase|root.*cause|architecture.*map/, agents: ["investigator", "planner"] },
            { pattern: /design.*architecture|plan.*system/, agents: ["planner", "researcher"] },
            { pattern: /review.*code|audit.*security/, agents: ["reviewer", "security"] },
            { pattern: /frontend|ui|ux|css|react/, agents: ["frontend", "ux-researcher"] },
            { pattern: /backend|api|database|server/, agents: ["backend", "database"] },
            { pattern: /deploy|ci\/cd|infrastructure/, agents: ["devops", "performance"] },
            { pattern: /marketing|sales|lead|social/, agents: ["marketing", "sales", "social"] },
            { pattern: /product|roadmap|feature/, agents: ["product", "analyst"] },
            { pattern: /content|youtube|video|story/, agents: ["content-creator", "youtube-agent", "visual-storyteller"] },
            { pattern: /legal|compliance|finance|budget/, agents: ["legal", "finance"] },
            { pattern: /mobile|ios|android|react-native/, agents: ["mobile", "qa"] },
            { pattern: /doc|documentation|readme/, agents: ["documentation", "reviewer"] },
            { pattern: /performance|benchmark|optimize/, agents: ["performance", "backend"] },
            { pattern: /automation|script|workflow/, agents: ["automator", "devops"] },
            { pattern: /travel|itinerary|hotel/, agents: ["travel-agent", "surfer"] },
            { pattern: /real-estate|property|investment/, agents: ["real-estate", "analyst"] },
            { pattern: /coach|agile|process/, agents: ["coach", "product"] },
        ];

        // Use adaptive complexity analysis
        const adaptiveAnalysis = analyzeTaskComplexity(taskDescription);
        if (adaptiveAnalysis.needsSwarm) {
            return {
                needsCollaboration: true,
                reason: `Advanced complexity (score ${adaptiveAnalysis.score}) suggests swarm collaboration.`,
                suggestedAgents: ["planner", "executor", "reviewer"],
            };
        }

        for (const indicator of indicators) {
            if (indicator.pattern.test(taskLower)) {
                return {
                    needsCollaboration: true,
                    reason: `Task requires multiple roles: ${indicator.agents.join(", ")}`,
                    suggestedAgents: indicator.agents,
                };
            }
        }

        // Complexity-based decision
        if (complexity >= 80) {
            return {
                needsCollaboration: true,
                reason: "High complexity task benefits from multiple agents",
                suggestedAgents: ["planner", "executor", "reviewer"],
            };
        }

        return {
            needsCollaboration: false,
            reason: "Task can be handled by single agent",
            suggestedAgents: [],
        };
    }

    /**
     * Create collaboration plan
     */
    export async function createPlan(
        taskDescription: string,
        suggestedAgents: AgentRole[]
    ): Promise<CollaborationTask> {
        const taskId = `collab-${Date.now()}`;

        // Define agents based on roles
        const agents: AgentSpec[] = suggestedAgents.map((role, index) => ({
            id: `agent-${role}-${index}`,
            role,
            thinkingLevel: getThinkingLevelForRole(role),
            capabilities: getCapabilitiesForRole(role),
            tools: getToolsForRole(role),
        }));

        // Create subtasks
        const subtasks: Subtask[] = createSubtasks(taskDescription, suggestedAgents);

        const task: CollaborationTask = {
            id: taskId,
            description: taskDescription,
            subtasks,
            agents,
            coordinator: "agent-planner-0",
            status: "pending",
        };

        // Persist to shared memory
        await saveTask(task);

        return task;
    }

    export async function saveTask(task: CollaborationTask) {
        await SharedMemory.set(task.id, task, "collaboration");
    }

    export async function loadTask(id: string): Promise<CollaborationTask | undefined> {
        return await SharedMemory.get(id, "collaboration");
    }

    export async function listTasks(): Promise<string[]> {
        return await SharedMemory.list("collaboration");
    }

    /**
     * Get thinking level for agent role
     */
    function getThinkingLevelForRole(role: AgentRole): ThinkingLevel {
        const levels: Record<AgentRole, ThinkingLevel> = {
            planner: "max",
            executor: "think",
            coding: "think",
            reviewer: "max",
            researcher: "max",
            debugger: "max",
            architect: "max",
            frontend: "think",
            backend: "think",
            devops: "think",
            security: "max",
            qa: "think",
            analyst: "max",
            automator: "think",
            coach: "max",
            "content-creator": "think",
            database: "think",
            documentation: "think",
            investigator: "max",
            finance: "max",
            "lead-generator": "think",
            legal: "max",
            marketing: "max",
            mobile: "think",
            performance: "max",
            product: "max",
            ralph: "max",
            "real-estate": "max",
            refactor: "think",
            sales: "think",
            social: "think",
            support: "think",
            surfer: "max",
            tester: "think",
            "travel-agent": "max",
            "ux-researcher": "max",
            "visual-storyteller": "think",
            "youtube-agent": "think",
        };
        return levels[role];
    }

    /**
     * Get capabilities for agent role
     */
    function getCapabilitiesForRole(role: AgentRole): string[] {
        const capabilities: Record<AgentRole, string[]> = {
            planner: ["planning", "task-decomposition", "system-design", "architectural-patterns"],
            executor: ["implementation", "coding"],
            coding: ["high-quality-implementation", "refactoring", "bug-fixes"],
            reviewer: ["code-review", "quality-assurance"],
            researcher: ["documentation", "web-search", "code-analysis", "information-synthesis"],
            debugger: ["debugging", "troubleshooting"],
            architect: ["system-design", "architecture", "patterns", "scalability"],
            frontend: ["ui-design", "css", "react"],
            backend: ["api-design", "database", "server-logic"],
            devops: ["deployment", "ci-cd", "infrastructure"],
            security: ["vulnerability-analysis", "security-audit"],
            qa: ["testing", "test-automation"],
            analyst: ["data-analysis", "reporting", "insights"],
            automator: ["scripting", "workflow-automation"],
            coach: ["agile-coaching", "process-improvement"],
            "content-creator": ["content-generation", "copywriting"],
            database: ["schema-design", "query-optimization"],
            documentation: ["technical-writing", "structured-docs"],
            investigator: ["codebase-analysis", "root-cause-analysis", "architecture-mapping"],
            finance: ["financial-planning", "budget-analysis"],
            "lead-generator": ["lead-qualification", "outreach"],
            legal: ["compliance-check", "contract-review"],
            marketing: ["seo", "marketing-strategy"],
            mobile: ["ios-dev", "android-dev", "react-native"],
            performance: ["benchmarking", "optimization"],
            product: ["product-strategy", "roadmap"],
            ralph: ["autonomous-coding", "continuous-iteration"],
            "real-estate": ["market-analysis", "property-valuation"],
            refactor: ["code-improvement", "clean-code"],
            sales: ["sales-intelligence", "lead-gen"],
            social: ["social-media-strategy", "trend-analysis"],
            support: ["customer-support", "issue-resolution"],
            surfer: ["web-research", "scraping"],
            tester: ["unit-testing", "integration-testing"],
            "travel-agent": ["travel-planning", "logistics"],
            "ux-researcher": ["user-research", "usability-testing"],
            "visual-storyteller": ["visual-narrative", "branding"],
            "youtube-agent": ["youtube-strategy", "scriptwriting"],
        };
        return capabilities[role];
    }

    /**
     * Get tools for agent role
     */
    function getToolsForRole(role: AgentRole): string[] {
        const common = ["read", "grep", "codesearch", "skill"];
        const tools: Record<AgentRole, string[]> = {
            planner: [...common, "task", "glob", "websearch", "googlesearch"],
            executor: [...common, "write", "edit", "bash", "test"],
            coding: [...common, "write", "edit", "bash", "test"],
            reviewer: [...common, "websearch", "googlesearch"],
            researcher: [...common, "websearch", "googlesearch", "browser"],
            debugger: [...common, "bash", "websearch", "googlesearch"],
            architect: [...common, "websearch", "glob"],
            frontend: [...common, "write", "edit", "browser"],
            backend: [...common, "write", "edit", "bash"],
            devops: [...common, "bash", "write", "edit"],
            security: [...common, "bash", "websearch"],
            qa: [...common, "test", "bash"],
            analyst: [...common, "websearch", "bash"],
            automator: [...common, "bash", "write"],
            coach: [...common, "websearch"],
            "content-creator": [...common, "write", "websearch"],
            database: [...common, "bash", "write"],
            documentation: [...common, "write", "edit"],
            investigator: [...common, "glob", "read", "grep", "codesearch"],
            finance: [...common, "websearch"],
            "lead-generator": [...common, "websearch"],
            legal: [...common, "websearch"],
            marketing: [...common, "websearch"],
            mobile: [...common, "write", "edit", "bash"],
            performance: [...common, "bash", "test"],
            product: [...common, "websearch"],
            ralph: [...common, "write", "edit", "bash", "test"],
            "real-estate": [...common, "websearch"],
            refactor: [...common, "write", "edit"],
            sales: [...common, "websearch"],
            social: [...common, "websearch"],
            support: [...common, "websearch"],
            surfer: [...common, "websearch", "googlesearch", "browser"],
            tester: [...common, "test", "bash"],
            "travel-agent": [...common, "websearch", "googlesearch"],
            "ux-researcher": [...common, "websearch", "googlesearch", "browser"],
            "visual-storyteller": [...common, "write", "websearch", "googlesearch"],
            "youtube-agent": [...common, "websearch", "googlesearch"],
        };
        return tools[role];
    }

    /**
     * Create subtasks for collaboration
     */
    function createSubtasks(taskDescription: string, roles: AgentRole[]): Subtask[] {
        const subtasks: Subtask[] = [];
        let taskId = 0;

        // Force at least one research component for complex planning tasks
        if (roles.includes("planner") && !roles.includes("researcher")) {
            roles.unshift("researcher");
        }

        // Create subtasks based on roles
        for (const role of roles) {
            // Elastic Swarm Logic:
            // Dynamically scale instances based on task complexity or explicit request.
            let numInstances = 1;
            const isResearchRole = role === "researcher" || role === "surfer" || role === "ux-researcher";
            const isImplementationRole = role === "executor" || role === "coding" || role === "frontend" || role === "backend";

            if (isResearchRole || taskDescription.toLowerCase().includes("search") || taskDescription.toLowerCase().includes("web")) {
                const isComplex = taskDescription.length > 200 || taskDescription.includes("comprehensive") || taskDescription.includes("deep");
                numInstances = isComplex ? 5 : 3;
            } else if (isImplementationRole) {
                const isParallel = taskDescription.toLowerCase().includes("parallel") || taskDescription.toLowerCase().includes("multiple");
                numInstances = isParallel ? 3 : 1;
            }

            // Universal Scaling: Allow user to override instance count (e.g., "5 coding agents", "2 surfers")
            // Capped at 10 for research, 5 for others.
            const numPattern = new RegExp(`(\\d+)\\s+(${role}|${role}s|agents)`);
            const match = taskDescription.toLowerCase().match(numPattern);
            if (match) {
                const maxCap = isResearchRole ? 10 : 5;
                numInstances = Math.min(maxCap, Math.max(1, parseInt(match[1]!)));
            }

            for (let i = 0; i < numInstances; i++) {
                const subtask: Subtask = {
                    id: `subtask-${taskId++}`,
                    description: createSubtaskDescription(taskDescription, role, i, numInstances),
                    assignedTo: `agent-${role}-${i}`,
                    dependencies: [],
                    status: "pending",
                };

                // Add dependencies based on role order
                if (isImplementationRole) {
                    // Implementers depend on planner/researcher results
                    const parent = subtasks.find(s => s.assignedTo.includes("planner") || s.assignedTo.includes("researcher"));
                    if (parent) subtask.dependencies.push(parent.id);
                } else if (role === "reviewer" || role === "qa" || role === "security") {
                    // Reviewers depend on implementers
                    const implementer = subtasks.find(s =>
                        s.assignedTo.includes("executor") ||
                        s.assignedTo.includes("coding") ||
                        s.assignedTo.includes("frontend") ||
                        s.assignedTo.includes("backend")
                    );
                    if (implementer) subtask.dependencies.push(implementer.id);
                }

                subtasks.push(subtask);
            }
        }

        return subtasks;
    }

    /**
     * Create description for subtask
     */
    function createSubtaskDescription(taskDescription: string, role: AgentRole, index: number = 0, total: number = 1): string {
        if ((role === "surfer" || role === "researcher") && total >= 3) {
            // Implement 2:1 ratio for web search and google ai search as per requirement
            const googleAiCount = Math.floor(total / 3);
            if (index < googleAiCount) {
                return `Perform Google AI Search (summarized overview) for: "${taskDescription}" (Worker ${index + 1}/${total})`;
            } else {
                return `Perform Web Search (broad crawl) for: "${taskDescription}" (Worker ${index + 1}/${total})`;
            }
        }

        const descriptions: Record<AgentRole, string> = {
            planner: `Strategize, architect, and plan: "${taskDescription}"`,
            executor: `Implement (General): "${taskDescription}"`,
            coding: `Implement (High-Precision Engineering): "${taskDescription}"`,
            reviewer: `Review implementation of: "${taskDescription}"`,
            researcher: `Deep-research and synthesize information for: "${taskDescription}"`,
            debugger: `Debug and troubleshoot: "${taskDescription}"`,
            architect: `Design architecture for: "${taskDescription}"`,
            frontend: `Implement frontend for: "${taskDescription}"`,
            backend: `Implement backend for: "${taskDescription}"`,
            devops: `Setup infrastructure/deployment for: "${taskDescription}"`,
            security: `Perform security audit for: "${taskDescription}"`,
            qa: `Test implementation of: "${taskDescription}"`,
            analyst: `Analyze data for: "${taskDescription}"`,
            automator: `Automate workflow for: "${taskDescription}"`,
            coach: `Coach team on: "${taskDescription}"`,
            "content-creator": `Create content for: "${taskDescription}"`,
            database: `Manage database for: "${taskDescription}"`,
            documentation: `Document: "${taskDescription}"`,
            investigator: `Investigate codebase and map architecture for: "${taskDescription}"`,
            finance: `Analyze finances for: "${taskDescription}"`,
            "lead-generator": `Generate leads for: "${taskDescription}"`,
            legal: `Review legal aspects of: "${taskDescription}"`,
            marketing: `Plan marketing for: "${taskDescription}"`,
            mobile: `Implement mobile app for: "${taskDescription}"`,
            performance: `Optimize performance for: "${taskDescription}"`,
            product: `Manage product for: "${taskDescription}"`,
            ralph: `Iteratively implement: "${taskDescription}"`,
            "real-estate": `Analyze real estate for: "${taskDescription}"`,
            refactor: `Refactor: "${taskDescription}"`,
            sales: `Handle sales for: "${taskDescription}"`,
            social: `Manage social media for: "${taskDescription}"`,
            support: `Provide support for: "${taskDescription}"`,
            surfer: `Research web for: "${taskDescription}"`,
            tester: `Write tests for: "${taskDescription}"`,
            "travel-agent": `Plan travel for: "${taskDescription}"`,
            "ux-researcher": `Research UX for: "${taskDescription}"`,
            "visual-storyteller": `Tell visual story for: "${taskDescription}"`,
            "youtube-agent": `Manage YouTube for: "${taskDescription}"`,
        };

        return total > 1
            ? `${descriptions[role]} (Worker ${index + 1}/${total})`
            : descriptions[role];
    }

    /**
     * Assign subtask to agent
     */
    export async function assignSubtask(
        collaboration: CollaborationTask,
        subtaskId: string,
        agentId: string
    ): Promise<CollaborationTask> {
        const subtask = collaboration.subtasks.find(s => s.id === subtaskId);
        if (subtask) {
            subtask.assignedTo = agentId;
            subtask.status = "in-progress";
            log.info(`Assigned subtask ${subtaskId} to ${agentId}`);
            await saveTask(collaboration);
        }
        return collaboration;
    }

    /**
     * Update subtask status
     */
    export async function updateSubtaskStatus(
        collaboration: CollaborationTask,
        subtaskId: string,
        status: "completed" | "failed",
        result?: string
    ): Promise<CollaborationTask> {
        const subtask = collaboration.subtasks.find(s => s.id === subtaskId);
        if (subtask) {
            subtask.status = status;
            subtask.result = result;
            log.info(`Updated subtask ${subtaskId} to ${status}`);

            // Check if all subtasks are complete
            const allComplete = collaboration.subtasks.every(s =>
                s.status === "completed" || s.status === "failed"
            );

            if (allComplete) {
                const hasFailures = collaboration.subtasks.some(s => s.status === "failed");
                collaboration.status = hasFailures ? "failed" : "completed";
            }
            await saveTask(collaboration);
        }
        return collaboration;
    }

    /**
     * Get next subtask for agent
     */
    export function getNextSubtask(
        collaboration: CollaborationTask,
        agentId: string
    ): Subtask | null {
        // Find subtasks assigned to this agent
        const agentSubtasks = collaboration.subtasks.filter(s =>
            s.assignedTo === agentId && s.status === "pending"
        );

        // Check dependencies
        for (const subtask of agentSubtasks) {
            const depsMet = subtask.dependencies.every(depId => {
                const dep = collaboration.subtasks.find(s => s.id === depId);
                return dep && dep.status === "completed";
            });

            if (depsMet) {
                return subtask;
            }
        }

        return null;
    }

    /**
     * Generate collaboration summary
     */
    export function generateSummary(collaboration: CollaborationTask): string {
        const parts: string[] = [];

        parts.push(`## Collaboration Summary: ${collaboration.id}`);
        parts.push(`Task: ${collaboration.description}`);
        parts.push(`Status: ${collaboration.status}`);
        parts.push(`Coordinator: ${collaboration.coordinator}`);

        parts.push("\n### Agents:");
        for (const agent of collaboration.agents) {
            parts.push(`- ${agent.id} (${agent.role}) - ${agent.thinkingLevel} thinking`);
        }

        parts.push("\n### Subtasks:");
        for (const subtask of collaboration.subtasks) {
            const statusIcon = subtask.status === "completed" ? "✅" :
                subtask.status === "failed" ? "❌" : "⏳";
            parts.push(`${statusIcon} ${subtask.id}: ${subtask.description}`);
            parts.push(`   Assigned to: ${subtask.assignedTo}`);
            if (subtask.result) {
                parts.push(`   Result: ${subtask.result.substring(0, 100)}...`);
            }
        }

        return parts.join("\n");
    }

    /**
     * Suggest collaboration for task
     */
    export function suggest(
        taskDescription: string,
        complexity: number
    ): { suggestion: string; agents: AgentRole[]; confidence: number } | null {
        const analysis = analyze(taskDescription, complexity);

        if (!analysis.needsCollaboration) {
            return null;
        }

        const confidence = Math.min(1, complexity / 100);

        return {
            suggestion: analysis.reason,
            agents: analysis.suggestedAgents,
            confidence,
        };
    }
}


