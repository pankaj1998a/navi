
import { AgentRunner } from "../src/agent/agent-runner"
import { Agent } from "../src/agent/agent"
import { Log } from "../src/util/log"
import { Instance } from "../src/project/instance"

const log = Log.create({ service: "test-real-agents" })

async function main() {
    const directory = process.cwd()

    await Instance.provide({
        directory,
        fn: async () => {
            const runner = new AgentRunner()

            console.log("Starting real agent test...")
            console.log(`Working directory: ${directory}`)

            // Define tasks for different agents
            const tasks = [
                {
                    id: "task-1",
                    type: "architect",
                    description: "Analyze the current project structure and suggest 3 improvements based on modern best practices.",
                },
                {
                    id: "task-2",
                    type: "researcher",
                    description: "Research the latest version of React and summarize the key new features in React 19.",
                },
                {
                    id: "task-3",
                    type: "coding",
                    description: "Write a simple TypeScript function that calculates the Fibonacci sequence up to n numbers and include JSDoc comments.",
                }
            ] as any[]

            console.log(`Running ${tasks.length} tasks in parallel...`)

            const results = await runner.runParallel(tasks)

            console.log("\n--- Execution Results ---\n")

            for (const result of results) {
                console.error(`Task: ${result.taskId}`)
                console.error(`Success: ${result.success}`)
                if (result.success) {
                    console.error("Output:")
                    console.error(result.output)
                } else {
                    console.error("Error:")
                    console.error(result.error)
                }
                console.error("\n-------------------------\n")
            }
        }
    })
}

main().catch(console.error)
