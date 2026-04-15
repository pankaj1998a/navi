import { AgentTemplate } from "../programmatic"

/**
 * DatabaseDoctor Agent
 * Phase: Database
 * Responsibility: Schema design, query optimization, and data integrity.
 */
export const DatabaseDoctor: AgentTemplate = {
    id: "database-doctor",
    name: "DatabaseDoctor",
    description: "Specializes in database schema design, migrations and optimizations",
    tools: ["read", "write", "edit", "grep"],
    phase: "database",
    skills: ["database-schema", "database-correct", "database-authorization", "database-group", "preliminary-database-schema"],
    handleSteps: async function* (context) {
        yield { type: "step", name: "Schema Analysis", description: "Evaluating current database structure and requirements" }
        yield { type: "log", message: "Designing optimized indexes and relationship mappings..." }
        yield { type: "step", name: "Migration Planning", description: "Creating idempotent migration scripts" }
        yield { type: "step", name: "Integrity Verification", description: "Applying constraints and triggering validation checks" }
        yield { type: "finish", result: "Database schema and migrations finalized." }
    }
}
