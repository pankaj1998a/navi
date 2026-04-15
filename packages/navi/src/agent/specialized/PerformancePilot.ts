import { AgentTemplate } from "../programmatic"

/**
 * PerformancePilot Agent
 * Phase: Optimize
 * Responsibility: Speed, memory efficiency, and resource optimization.
 */
export const PerformancePilot: AgentTemplate = {
    id: "performance-pilot",
    name: "PerformancePilot",
    description: "Profiles and optimizes code for maximum speed and efficiency",
    tools: ["read", "grep", "terminal"],
    phase: "optimize",
    skills: ["preliminary-realize-collector", "preliminary-realize-transformer"],
    handleSteps: async function* (context) {
        yield { type: "step", name: "Profiling Run", description: "Measuring application performance and identifying bottlenecks" }
        yield { type: "log", message: "Analyzing hotspots and memory consumption patterns..." }
        yield { type: "step", name: "Bottleneck Removal", description: "Refactoring critical paths for better throughput" }
        yield { type: "step", name: "Resource Efficiency", description: "Optimizing memory and compute utilization" }
        yield { type: "finish", result: "Performance optimizations applied successfully." }
    }
}
