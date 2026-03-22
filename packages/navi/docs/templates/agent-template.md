# Agent: [Agent Name]

## Overview
[A brief description of what the agent does and its primary purpose.]

## Capabilities
- **Capability 1**: [Description]
- **Capability 2**: [Description]

## Configuration
| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | The name of the agent |
| `mode` | enum | Yes | Execution mode (subagent, primary, etc.) |
| `topP` | number | No | Nucleus sampling parameter |
| `temperature` | number | No | Sampling temperature |

## Examples
### Basic Usage
\`\`\`bash
navi run "Task for this agent" --agent=[Agent Name]
\`\`\`

### Advanced Usage
\`\`\`typescript
import { Orchestrator } from "./agent/orchestrator"
// Programmatic example
\`\`\`

## See Also
- [Link to other related agent]
- [Link to tool docs]
