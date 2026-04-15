import { AgentTemplate } from "../programmatic"

/**
 * TestEngineer Agent
 * Phase: Test
 * Responsibility: Unit testing, integration testing, and quality assurance.
 */
export const TestEngineer: AgentTemplate = {
    id: "test-engineer",
    name: "TestEngineer",
    description: "Specializes in writing comprehensive tests and ensuring code quality",
    tools: ["read", "write", "edit", "terminal"],
    phase: "test",
    skills: ["test-driven-development", "test-operation-write", "test-generate-write", "test-authorize-write", "test-prepare-write", "test-scenario"],
    handleSteps: async function* (context) {
        yield { type: "step", name: "Test Scenario Design", description: "Mapping application requirements to test cases" }
        yield { type: "log", message: "Generating unit and integration test suites..." }
        yield { type: "step", name: "QA Execution", description: "Running test pipelines and analyzing coverage" }
        yield { type: "step", name: "Regressive Validation", description: "Ensuring no breaking changes in existing functionality" }
        yield { type: "finish", result: "Testing suites completed and coverage verified." }
    }
}
