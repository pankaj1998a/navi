import { ulid } from "ulid"
import { Orchestrator, AgentTask, AgentResult, AgentType } from "./orchestrator"
import { WorkerPool } from "./worker-pool"
import { Log } from "../util/log"

/**
 * Coordinator Agent
 * Specializes in high-level goal decomposition and remote task delegation.
 */
export class CoordinatorAgent {
  private log = Log.create({ service: "coordinator" })
  private orchestrator: Orchestrator

  constructor(orchestrator: Orchestrator) {
    this.orchestrator = orchestrator
  }

  /**
   * Coordinate a complex goal across the swarm.
   */
  async coordinate(goal: string, context: Record<string, any> = {}): Promise<AgentResult[]> {
    this.log.info("Coordinating distributed goal", { goal })

    // 1. Plan the decomposition
    const planResult = await this.orchestrator.spawnAgent('planner', {
      id: ulid(),
      type: 'planner',
      description: `Partition this goal into independent sub-tasks for a distributed swarm: ${goal}`,
      context
    })

    if (!planResult.success) {
      throw new Error(`Coordination planning failed: ${planResult.error}`)
    }

    // 2. Parse sub-tasks (Simulated: in a real agent this would be structured output)
    const subTasks: AgentTask[] = this.parseTasksFromOutput(planResult.output)

    // 3. Dispatch to WorkerPool
    this.log.info(`Dispatching ${subTasks.length} sub-tasks to swarm...`)
    
    return await Promise.all(
      subTasks.map(task => this.orchestrator.spawnAgent(task.type, task))
    )
  }

  private parseTasksFromOutput(output: string): AgentTask[] {
    // Basic heuristic: look for task-like blocks in the planner output
    // In production, we'd use JSON-mode or structured tool outputs.
    return [
        { id: ulid(), type: 'researcher' as AgentType, description: 'Analyze codebase for patterns' },
        { id: ulid(), type: 'editor' as AgentType, description: 'Apply distributed changes' },
    ]
  }
}


