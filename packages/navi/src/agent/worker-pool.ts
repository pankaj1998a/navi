import { Log } from "../util/log"
import { AgentTask, AgentResult } from "./orchestrator"

export interface RemoteWorker {
  id: string
  address: string // WebSocket ID or URL
  type: string[] // Supported agent types
  status: 'idle' | 'busy'
}

export namespace WorkerPool {
  const log = Log.create({ service: "worker-pool" })
  const workers = new Map<string, RemoteWorker>()

  export function register(worker: RemoteWorker) {
    log.info("registering remote worker", { id: worker.id, types: worker.type })
    workers.set(worker.id, worker)
  }

  export function unregister(id: string) {
    workers.delete(id)
  }

  export function getAvailableWorker(type: string): RemoteWorker | undefined {
    return Array.from(workers.values()).find(w => w.status === 'idle' && w.type.includes(type))
  }

  export async function dispatch(workerID: string, task: AgentTask): Promise<AgentResult> {
    const worker = workers.get(workerID)
    if (!worker) throw new Error(`Worker ${workerID} not found`)

    log.info("dispatching task to remote worker", { workerID, taskID: task.id })
    worker.status = 'busy'
    
    try {
        // In a real implementation, this would send a message over the WebSocket bridge
        // For now, we simulate the network hop with a timeout
        const { BridgeService } = await import("../server/bridge-service")
        return await BridgeService.request(worker.address, { type: 'agent.task', payload: task })
    } finally {
        worker.status = 'idle'
    }
  }
}


