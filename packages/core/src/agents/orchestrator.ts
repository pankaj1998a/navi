import { SessionID } from '../session/schema';

export type AgentType = string;

export interface AgentTask {
    id: string;
    type: AgentType;
    description: string;
    context?: Record<string, unknown>;
    dependencies?: string[];
}

export interface AgentResult {
    taskId: string;
    success: boolean;
    output: string;
    metrics?: {
        duration: number;
        tokens: number;
    };
    error?: string;
}

export class Orchestrator {
    async spawnAgent(agentType: AgentType, task: AgentTask, options: { autoVerify?: boolean, sessionID?: SessionID } = {}): Promise<AgentResult> {
        return { taskId: task.id, success: true, output: 'Core mock' };
    }

    async *waterfallWorkflow(goal: string): AsyncIterable<AgentResult | string> {
        yield `Starting waterfall for: ${goal}`;
        yield { taskId: 'architect', success: true, output: 'Architect phase complete (mock)' };
        yield { taskId: 'coding', success: true, output: 'Coding phase complete (mock)' };
    }
}
