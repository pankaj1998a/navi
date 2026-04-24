import { AgentRegistry, type AgentTemplate } from "../programmatic"
import REVIEW_PROMPT from "../prompt/review.txt"

const ReviewAgent: AgentTemplate = {
    id: "review",
    name: "Navi Review",
    description: "Reviews code changes and produces actionable quality feedback.",
    phase: "analyze",
    skills: ["code-review", "quality-control"],
    tools: ["read", "list", "glob", "grep", "codesearch", "bash", "question"],
    systemPrompt: REVIEW_PROMPT.trim(),
}

AgentRegistry.register(ReviewAgent)

export { ReviewAgent }
export default ReviewAgent
