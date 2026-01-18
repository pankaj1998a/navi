# Agents Documentation

Navi includes a powerful multi-agent system for parallel task execution.

## Built-in Agents

| Agent | Purpose | Tools |
|-------|---------|-------|
| `master` | Task routing and orchestration | All delegation tools |
| `generalist` | General-purpose coding tasks | Full tool access |
| `codebase_investigator` | Code analysis and understanding | Read-only tools |
| `autonomous_loop` | PRD-driven autonomous execution | File and shell tools |

## Agent Types

### Local Agents
Run in the current process with full tool access.

```typescript
const agent: LocalAgentDefinition = {
  kind: 'local',
  name: 'my_agent',
  displayName: 'My Agent',
  description: 'Does something useful',
  toolConfig: {
    tools: ['read_file', 'write_file', 'shell'],
  },
};
```

### Remote Agents
Cloud-based agents for background tasks.

```typescript
const agent: RemoteAgentDefinition = {
  kind: 'remote',
  name: 'cloud_agent',
  endpoint: 'https://api.example.com/agent',
};
```

## Master Agent

The Master Agent orchestrates other agents:

1. **Task Router** - Analyzes tasks and assigns to appropriate agents
2. **Model Manager** - Selects optimal model for task complexity
3. **Load Balancer** - Distributes work across available agents

## Agent Supervisor

Manages agent lifecycle:

```typescript
import { AgentSupervisor } from './agent-supervisor.js';

const supervisor = new AgentSupervisor(config, registry);

// Spawn an agent
const agentId = await supervisor.spawn('generalist', { task: 'Fix bug' });

// Stop an agent
await supervisor.stop(agentId);

// Restart with retries
await supervisor.restart(agentId);
```

## Parallel Execution

Run multiple agents concurrently:

```typescript
import { ParallelAgentOrchestrator } from './parallel-agent-orchestrator.js';

const orchestrator = new ParallelAgentOrchestrator(config, registry);

const results = await orchestrator.runParallel([
  { agent: 'codebase_investigator', input: 'Analyze auth module' },
  { agent: 'generalist', input: 'Fix login bug' },
  { agent: 'generalist', input: 'Update tests' },
]);
```

## Shared Memory

Agents can share data via `AgentMemory`:

```typescript
import { AgentMemory } from './agent-memory.js';

const memory = AgentMemory.getInstance();

// Set with TTL
memory.set('task_result', { status: 'complete' }, 60000);

// Get from any agent
const result = memory.get('task_result');
```

## Creating Custom Agents

1. Create agent definition file
2. Register with `AgentRegistry`
3. Add to config if needed

```typescript
// my-agent.ts
export const MyAgent: LocalAgentDefinition = {
  kind: 'local',
  name: 'my_custom_agent',
  // ... configuration
};

// Register
registry.register(MyAgent);
```
