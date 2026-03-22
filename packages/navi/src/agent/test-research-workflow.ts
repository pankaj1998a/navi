import { AgentSystem } from "./agent-system"
import "./roles/index" // Register all roles

/**
 * Test script for Research-based Multi-Agent Workflow
 */
async function runResearchTest() {
    console.log("🚀 Starting Research Multi-Agent Workflow Test\n")

    const tasks = [
        {
            agent: "researcher",
            prompt: "What are the latest best practices for React Server Components as of 2026?"
        }
    ]

    const mockExecutor = async (task: AgentSystem.Task): Promise<string> => {
        return `Simulated result for agent ${task.agentName} on task: ${task.prompt}`
    }

    try {
        console.log("📦 Executing Research task...")

        const result = await AgentSystem.run(tasks, mockExecutor, {
            mode: "sequential",
            emitPart: (async (part: any) => {
                if (part.type === "subtask") {
                    console.log(`📡 [Parallel Spawn] Spawning: ${part.agent} | ${part.description}`)
                } else if (part.type === "step-start") {
                    console.log(`   🔸 [Step] ${part.snapshot}`)
                } else if (part.type === "text" && part.metadata?.flavor === "log") {
                    console.log(`   📝 [Log] ${part.text}`)
                }
            }) as any
        })

        console.log("\n--- Research Workflow Summary ---")
        console.log(`Total Root Tasks: ${result.results.length}`)
        result.results.forEach((r: any, i: number) => {
            console.log(`${i + 1}. [@${r.agent}] Result: ${r.result?.trim().slice(0, 150)}...`)
        })
        console.log("---------------------------------\n")
        console.log("✅ Research Workflow Completed!")

    } catch (error) {
        console.error("\n❌ Workflow Failed:", error)
    }
}

runResearchTest().catch(console.error)
