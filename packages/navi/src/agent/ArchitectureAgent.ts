import { Log } from "../util/log"
import { AgentRunner } from "./agent-runner"

const log = Log.create({ service: "architecture-agent" })

export interface ArchitectureMap {
    projectType: string
    entryPoints: string[]
    coreModules: string[]
    dependencies: string[]
    summary: string
}

/**
 * ArchitectureAgent specializes in repo-wide structural discovery.
 * It is invoked during onboarding or explicitly via /arch.
 */
export class ArchitectureAgent {
    constructor(private runner: AgentRunner) {}

    /**
     * Performs a deep crawl of the current workspace to understand architecture.
     */
    async discover(): Promise<ArchitectureMap> {
        log.info("Starting architecture discovery...")
        
        // In a real implementation, this would spawn subagents to:
        // 1. Read package.json / cargo.toml / go.mod
        // 2. Scan src/ directory for main entry points
        // 3. Summarize the findings
        
        // Mocking the result for parity demonstration
        return {
            projectType: "Bun/TypeScript Monorepo",
            entryPoints: ["packages/navi/src/cli/index.ts"],
            coreModules: ["agent", "tool", "session", "project"],
            dependencies: ["solid-js", "zod", "ai", "@navi-ai/sdk"],
            summary: "Navi is a modular, AI-first Developer OS built with TypeScript and Bun."
        }
    }

    /**
     * Formats the architecture map for display in the TUI or markdown.
     */
    static formatForUser(map: ArchitectureMap): string {
        return `
# Architecture Discovery Report

**Project Type**: ${map.projectType}
**Entry Points**: ${map.entryPoints.join(', ')}
**Core Modules**: ${map.coreModules.join(', ')}

## Overview
${map.summary}

## External Dependencies
- ${map.dependencies.join('\n- ')}
`
    }
}


