import { Orchestrator, WorkflowBuilder } from "./packages/navi/src/agent/orchestrator"
import { Log } from "./packages/navi/src/util/log"

const log = Log.create({ service: "dag-test" })

async function runTest() {
    const orchestrator = new Orchestrator()
    const builder = new WorkflowBuilder()

    log.info("Starting DAG test workflow...")

    // Define a DAG: 
    // step1 & step2 (parallel) -> step3 (dependent on 1 & 2)
    const step1Id = 'step1'
    const step2Id = 'step2'

    // We can't strictly use IDs in spawn() yet in a way that builder captures for next steps 
    // easily without some manual wiring, but let's test the orchestration logic.

    const tasks = [
        {
            id: 'T1',
            type: 'researcher' as const,
            description: 'Research topic A',
        },
        {
            id: 'T2',
            type: 'researcher' as const,
            description: 'Research topic B',
        },
        {
            id: 'T3',
            type: 'planner' as const,
            description: 'Synthesize A and B',
            dependencies: ['T1', 'T2']
        }
    ]

    log.info("Executing DAG tasks...")
    const results = await orchestrator.coordinateAgents(tasks)

    log.info("Workflow completed", {
        totalResults: results.length,
        taskIds: results.map(r => r.taskId),
        successCount: results.filter(r => r.success).length
    })

    // Test WorkflowBuilder parallel block
    const builder2 = new WorkflowBuilder()
    builder2.parallel([
        { type: 'researcher', description: 'Parallel 1' },
        { type: 'researcher', description: 'Parallel 2' }
    ]).spawn('planner', 'Merge parallel results')

    log.info("Executing WorkflowBuilder blocks...")
    const results2 = await orchestrator.executeWorkflow(builder2)
    log.info("Workflow 2 completed", {
        results: results2.map(r => ({ id: r.taskId, success: r.success }))
    })
}

// In a real env, we'd need to mock the agent execution or have agents ready.
// For now, this is a logic verification.
runTest().catch(console.error)
