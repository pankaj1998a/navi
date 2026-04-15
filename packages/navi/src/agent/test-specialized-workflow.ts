import { AgentSystem } from "./agent-system"
import "./roles/index" // Import to register all roles

/**
 * Test script for Multi-Agent Workflow
 */
async function runTestWorkflow() {
    console.log("🚀 Starting Multi-Agent Specialized Workflow Test\n")

    const tasks = [
        {
            agent: "planner",
            prompt: "Plan a feature to add a new REST endpoint for user profiles."
        },
        {
            agent: "editor",
            prompt: "Implement the planned profile endpoint."
        },
        {
            agent: "reviewer",
            prompt: "Review the implemented profile endpoint."
        }
    ]

    const mockExecutor = async (task: AgentSystem.Task): Promise<string> => {
        return `Simulated result for agent ${task.agentName}`
    }

    try {
        console.log("📦 Creating sequential batch for specialized agents...")

        const result = await AgentSystem.run(tasks, mockExecutor, {
            mode: "sequential",
            emitPart: (async (part: any) => {
                console.log(`   📡 [Event] ${part.type.padEnd(12)} | ${part.snapshot || part.reason || part.text || ""}`)
            }) as any
        })

        console.log("\n--- Workflow Summary ---")
        console.log(`Total Tasks: ${result.results.length}`)
        result.results.forEach((r: any, i: number) => {
            console.log(`${i + 1}. [@${r.agent}] Success: ${r.success} | Output: ${r.result?.trim().slice(0, 100)}...`)
        })
        console.log("------------------------\n")
        console.log("✅ Workflow Completed Successfully!")

    } catch (error) {
        console.error("\n❌ Workflow Failed:", error)
    }
}

runTestWorkflow().catch(console.error)


