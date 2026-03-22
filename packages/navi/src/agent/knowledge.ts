import fs from "fs/promises"
import path from "path"
import z from "zod"
import { MemoryManager } from "./memory-manager"

export const ProjectKnowledge = z.object({
    projectName: z.string(),
    projectType: z.string(),
    technologies: z.array(z.string()),
    architecture: z.object({
        pattern: z.string().optional(),
        components: z.array(z.string()).optional(),
    }).optional(),
    conventions: z.object({
        naming: z.string().optional(),
        formatting: z.string().optional(),
        testing: z.string().optional(),
    }).optional(),
    security: z.array(z.string()).optional(),
    api: z.object({
        endpoints: z.array(z.string()).optional(),
        schema: z.string().optional(),
    }).optional(),
    linkedRepos: z.array(z.object({
        name: z.string(),
        path: z.string(),
        purpose: z.string(),
    })).optional(),
})

export type ProjectKnowledge = z.infer<typeof ProjectKnowledge>

export class KnowledgeManager {
    static async detectKnowledge(directory: string): Promise<ProjectKnowledge> {
        const packageJson = await readPackageJson(directory)
        const readme = await readText(path.join(directory, "README.md"))
        const topLevelDirs = await listTopLevelDirs(directory)
        const files = new Set(await listTopLevelFiles(directory))
        const dependencyNames = collectDependencies(packageJson)
        const packageManager = typeof packageJson.packageManager === "string" ? packageJson.packageManager : ""
        const packageName = typeof packageJson.name === "string" ? packageJson.name : ""
        const readmeTitle = readmeHeading(readme) ?? ""
        const hasWorkspace = await detectWorkspace(directory, topLevelDirs, files)
        const hasCli = await detectCli(directory, packageJson, dependencyNames)
        const hasServer = await detectServer(directory, topLevelDirs, dependencyNames)
        const hasWeb = await detectWeb(directory, topLevelDirs, dependencyNames)
        const hasLibrary = detectLibrary(packageJson, hasCli)

        const projectName =
            packageName ||
            readmeTitle ||
            path.basename(directory) ||
            "Unknown Project"

        const technologies = new Set<string>()

        if (packageManager.startsWith("bun")) technologies.add("Bun")
        if (packageJson.type === "module") technologies.add("ESM")
        if (dependencyNames.has("typescript")) technologies.add("TypeScript")
        if (dependencyNames.has("zod")) technologies.add("Zod")
        if (dependencyNames.has("solid-js") || [...dependencyNames].some((dep) => dep.startsWith("@solidjs/"))) technologies.add("SolidJS")
        if (dependencyNames.has("hono") || [...dependencyNames].some((dep) => dep.startsWith("@hono/"))) technologies.add("Hono")
        if (dependencyNames.has("vite")) technologies.add("Vite")
        if (dependencyNames.has("turbo")) technologies.add("Turborepo")
        if (dependencyNames.has("yargs")) technologies.add("Yargs")
        if (dependencyNames.has("commander")) technologies.add("Commander")
        if (dependencyNames.has("ink")) technologies.add("Ink")
        if (dependencyNames.has("@clack/prompts") || dependencyNames.has("prompts")) technologies.add("Prompts")
        if (dependencyNames.has("express")) technologies.add("Express")
        if (dependencyNames.has("fastify")) technologies.add("Fastify")
        if (dependencyNames.has("next")) technologies.add("Next.js")
        if (dependencyNames.has("react")) technologies.add("React")
        if ([...dependencyNames].some((dep) => dep.startsWith("@opentelemetry/"))) technologies.add("OpenTelemetry")
        if ([...dependencyNames].some((dep) => dep.startsWith("@aws-sdk/"))) technologies.add("AWS SDK")
        if ([...dependencyNames].some((dep) => dep.startsWith("@octokit/"))) technologies.add("GitHub API")
        if ([...dependencyNames].some((dep) => dep.startsWith("@google/"))) technologies.add("Google GenAI")
        if (files.has("bunfig.toml")) technologies.add("Bun")
        if (files.has("turbo.json")) technologies.add("Turborepo")
        if (files.has("vite.config.ts") || files.has("vite.config.js")) technologies.add("Vite")
        if (files.has("pnpm-workspace.yaml")) technologies.add("pnpm workspaces")
        if (files.has("nx.json")) technologies.add("Nx")
        if (files.has("lerna.json")) technologies.add("Lerna")

        const projectType = detectProjectType({
            packageJson,
            packageName,
            readmeTitle,
            hasWorkspace,
            hasCli,
            hasServer,
            hasWeb,
            hasLibrary,
        })

        const components: string[] = []
        if (await existsAny(directory, ["src/cli", "packages/navi/src/cli"])) components.push("CLI runtime and commands")
        if (await existsAny(directory, ["src/server", "packages/navi/src/server"])) components.push("HTTP and RPC server")
        if (await existsAny(directory, ["src/agent", "packages/navi/src/agent"])) components.push("Agent orchestration and model selection")
        if (await existsAny(directory, ["src/session", "packages/navi/src/session"])) components.push("Session lifecycle and persistence")
        if (await existsAny(directory, ["src/tool", "packages/navi/src/tool"])) components.push("Tool execution surface")
        if (await existsAny(directory, ["packages/app", "packages/web", "src/web"])) components.push("Web UI and docs")
        if (await existsAny(directory, ["packages/slack"])) components.push("Slack integration")
        if (await existsAny(directory, ["packages/sdk", "packages/sdk/js"])) components.push("Shared SDK packages")
        if (await existsAny(directory, ["sdks/vscode"])) components.push("Editor extension integration")
        if (await existsAny(directory, ["github"])) components.push("GitHub automation")
        if (await existsAny(directory, ["specs"])) components.push("Living product specs")
        if (await existsAny(directory, ["infra"])) components.push("Deployment and infrastructure")
        if (topLevelDirs.length > 0 && components.length === 0) {
            components.push(...topLevelDirs.slice(0, 8).map((dirName) => `${dirName}: repository component`))
        }

        const conventions = detectConventions({
            packageJson,
            dependencyNames,
            hasCli,
            hasWeb,
        })

        const security = detectSecurity({
            dependencyNames,
            files,
            hasCli,
            hasServer,
            hasWeb,
        })

        const apiEndpoints = [
            hasCli ? "CLI command surface" : undefined,
            hasServer ? "HTTP and RPC server" : undefined,
            hasWeb ? "Web app routes and client entry points" : undefined,
            await existsAny(directory, ["packages/navi/src/p2p", "src/p2p"]) ? "P2P collaboration API" : undefined,
            await existsAny(directory, ["packages/navi/src/tool", "src/tool"]) ? "Tool execution surface" : undefined,
            await existsAny(directory, ["packages/navi/src/mcp", "src/mcp"]) ? "MCP integration" : undefined,
        ].filter(Boolean) as string[]

        return {
            projectName,
            projectType,
            technologies: [...technologies].sort((a, b) => a.localeCompare(b)),
            architecture: {
                pattern: hasCli && hasServer ? "Monorepo / service split" : "Monorepo",
                components: components.length ? components : undefined,
            },
            conventions,
            security,
            api: {
                endpoints: apiEndpoints.length ? apiEndpoints : undefined,
                schema: packageJson.description ?? undefined,
            },
            linkedRepos: [],
        }
    }

    static async syncProjectKnowledge(input: {
        projectID: string
        worktree: string
        knowledge?: ProjectKnowledge
    }) {
        const knowledge = input.knowledge ?? await this.detectKnowledge(input.worktree)
        const rendered = this.render(knowledge)
        if (!rendered.trim()) {
            return { knowledge, rendered: "", stored: false, removed: 0, existing: [] as MemoryManager.MemoryEntry[] }
        }

        const projectTag = `project:${input.projectID}`
        const existing = await this.recallProjectKnowledge(input.projectID, 10)
        const same = existing.find((entry) => entry.content === rendered)
        if (same) {
            const duplicates = existing.filter((entry) => entry.id !== same.id)
            for (const entry of duplicates) {
                await MemoryManager.remove(entry.id)
            }
            return { knowledge, rendered, stored: false, removed: duplicates.length, existing: [same] }
        }

        for (const entry of existing) {
            await MemoryManager.remove(entry.id)
        }

        const entry = await MemoryManager.store(rendered, {
            tier: "long",
            importance: 0.9,
            tags: ["project-knowledge", projectTag],
            metadata: {
                projectID: input.projectID,
                source: {
                    type: "project-knowledge",
                    projectID: input.projectID,
                    worktree: input.worktree,
                },
                knowledge,
            },
        })

        return { knowledge, rendered, stored: true, removed: existing.length, existing: [entry] }
    }

    static async recallProjectKnowledge(projectID: string, limit = 5) {
        return await MemoryManager.recall({
            tier: "long",
            tags: ["project-knowledge", `project:${projectID}`],
            limit,
            includeExpired: true,
        })
    }

    static async linkRepo(mainRepo: ProjectKnowledge, otherPath: string): Promise<ProjectKnowledge> {
        const otherKnowledge = await this.detectKnowledge(otherPath)
        return {
            ...mainRepo,
            linkedRepos: [
                ...(mainRepo.linkedRepos || []),
                {
                    name: otherKnowledge.projectName,
                    path: otherPath,
                    purpose: "linked workspace",
                }
            ]
        }
    }

    static render(knowledge: ProjectKnowledge): string {
        const sections: string[] = []
        sections.push("## Project Knowledge")
        sections.push(`- Project Name: ${knowledge.projectName}`)
        sections.push(`- Project Type: ${knowledge.projectType}`)
        if (knowledge.technologies.length) {
            sections.push(`- Technologies: ${knowledge.technologies.join(", ")}`)
        }
        if (knowledge.architecture?.pattern) {
            sections.push(`- Architecture: ${knowledge.architecture.pattern}`)
        }
        if (knowledge.architecture?.components?.length) {
            sections.push(`- Components: ${knowledge.architecture.components.join(", ")}`)
        }
        if (knowledge.conventions?.formatting || knowledge.conventions?.testing || knowledge.conventions?.naming) {
            const items = [knowledge.conventions.naming, knowledge.conventions.formatting, knowledge.conventions.testing].filter(Boolean)
            if (items.length) sections.push(`- Conventions: ${items.join("; ")}`)
        }
        if (knowledge.security?.length) {
            sections.push(`- Security: ${knowledge.security.join("; ")}`)
        }
        if (knowledge.api?.endpoints?.length) {
            sections.push(`- APIs: ${knowledge.api.endpoints.join(", ")}`)
        }
        if (knowledge.linkedRepos?.length) {
            sections.push(`- Linked Repos: ${knowledge.linkedRepos.map((repo) => `${repo.name} (${repo.purpose})`).join(", ")}`)
        }
        return sections.join("\n")
    }

    static generateTemplate(): string {
        return `# Project Knowledge: [Project Name]

## Overview
- **Project Type**: [e.g., Web App, CLI, Library]
- **Frameworks**: [e.g., React, Express, SolidJS]
- **Language**: [e.g., TypeScript, JavaScript]

## Architecture
- **Pattern**: [e.g., MVC, Layered, Clean Architecture]
- **State Management**: [e.g., Redux, MobX, Context API]

## Conventions
- **Naming**: [e.g., PascalCase for components, camelCase for functions]
- **Code Style**: [e.g., Prettier, ESLint]

## Security
- [Security requirement 1]
- [Security requirement 2]
`
    }
}

async function exists(target: string) {
    return await fs.stat(target).then(() => true).catch(() => false)
}

async function readText(target: string) {
    return await fs.readFile(target, "utf8").catch(() => "")
}

async function readPackageJson(directory: string) {
    const text = await readText(path.join(directory, "package.json"))
    if (!text.trim()) return {}
    try {
        return JSON.parse(text) as Record<string, any>
    } catch {
        return {}
    }
}

async function listTopLevelDirs(directory: string) {
    return await fs.readdir(directory, { withFileTypes: true }).then((entries) =>
        entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    ).catch(() => [])
}

async function listTopLevelFiles(directory: string) {
    return await fs.readdir(directory, { withFileTypes: true }).then((entries) =>
        entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
    ).catch(() => [])
}

async function detectWorkspace(directory: string, topLevelDirs: string[], files: Set<string>) {
    if (files.has("pnpm-workspace.yaml") || files.has("turbo.json") || files.has("nx.json") || files.has("lerna.json")) {
        return true
    }
    if (topLevelDirs.includes("packages") || topLevelDirs.includes("apps") || topLevelDirs.includes("services")) {
        return true
    }
    return await exists(path.join(directory, "packages"))
}

async function detectCli(directory: string, pkg: Record<string, any>, dependencies: Set<string>) {
    const bin = pkg.bin
    const hasBin = typeof bin === "string" || (bin && typeof bin === "object" && Object.keys(bin).length > 0)
    return hasBin ||
        await existsAny(directory, ["src/cli", "packages/navi/src/cli"]) ||
        dependencies.has("yargs") ||
        dependencies.has("commander") ||
        dependencies.has("cac") ||
        dependencies.has("oclif") ||
        dependencies.has("ink") ||
        dependencies.has("clipanion") ||
        dependencies.has("@clack/prompts") ||
        dependencies.has("prompts")
}

async function detectServer(directory: string, topLevelDirs: string[], dependencies: Set<string>) {
    return await existsAny(directory, ["src/server", "packages/navi/src/server"]) ||
        topLevelDirs.includes("server") ||
        topLevelDirs.includes("api") ||
        dependencies.has("hono") ||
        dependencies.has("express") ||
        dependencies.has("fastify") ||
        dependencies.has("koa") ||
        dependencies.has("nest") ||
        dependencies.has("@hono/node-server")
}

async function detectWeb(directory: string, topLevelDirs: string[], dependencies: Set<string>) {
    return await existsAny(directory, ["src/web", "packages/app", "packages/web", "packages/navi/src/web"]) ||
        topLevelDirs.includes("app") ||
        topLevelDirs.includes("web") ||
        topLevelDirs.includes("client") ||
        dependencies.has("react") ||
        dependencies.has("next") ||
        dependencies.has("vite") ||
        dependencies.has("solid-js") ||
        dependencies.has("svelte") ||
        dependencies.has("vue")
}

function detectLibrary(pkg: Record<string, any>, hasCli: boolean) {
    return Boolean(pkg.main || pkg.exports || pkg.types || pkg.module) && !hasCli
}

function detectProjectType(input: {
    packageJson: Record<string, any>
    packageName: string
    readmeTitle: string
    hasWorkspace: boolean
    hasCli: boolean
    hasServer: boolean
    hasWeb: boolean
    hasLibrary: boolean
}) {
    const name = `${input.packageName} ${input.readmeTitle}`.toLowerCase()
    const isNaviLike = name.includes("navi")

    if (input.hasWorkspace && input.hasCli && input.hasServer) {
        return isNaviLike ? "Terminal AI assistant monorepo" : "CLI/server monorepo"
    }
    if (input.hasWorkspace && input.hasWeb) {
        return "Web monorepo"
    }
    if (input.hasWorkspace) {
        return "Monorepo"
    }
    if (input.hasCli && input.hasServer) {
        return "CLI/server application"
    }
    if (input.hasCli) {
        return "CLI application"
    }
    if (input.hasServer) {
        return "Server application"
    }
    if (input.hasWeb) {
        return "Web application"
    }
    if (input.hasLibrary) {
        return "Library/package"
    }
    if (input.packageJson.scripts && typeof input.packageJson.scripts === "object" && Object.keys(input.packageJson.scripts).length > 0) {
        return "TypeScript application"
    }
    return "TypeScript project"
}

function detectConventions(input: {
    packageJson: Record<string, any>
    dependencyNames: Set<string>
    hasCli: boolean
    hasWeb: boolean
}) {
    const naming = input.hasCli
        ? "camelCase for functions and kebab-case for commands"
        : input.hasWeb
            ? "PascalCase for components and camelCase for functions"
            : "Standard TypeScript naming conventions"

    const formatting = input.packageJson.prettier?.semi === false
        ? "Prettier semicolons disabled"
        : input.dependencyNames.has("prettier") || input.packageJson.prettier
            ? "Prettier formatting"
            : undefined

    const testingSignals = []
    if (typeof input.packageJson.scripts?.test === "string") testingSignals.push("test script")
    if (typeof input.packageJson.packageManager === "string" && input.packageJson.packageManager.startsWith("bun")) testingSignals.push("bun:test")
    if (input.dependencyNames.has("vitest")) testingSignals.push("vitest")
    if (input.dependencyNames.has("jest")) testingSignals.push("Jest")
    if (input.dependencyNames.has("playwright")) testingSignals.push("Playwright")
    const testing = testingSignals.length ? [...new Set(testingSignals)].join(" + ") : undefined

    return {
        naming,
        formatting,
        testing,
    }
}

function detectSecurity(input: {
    dependencyNames: Set<string>
    files: Set<string>
    hasCli: boolean
    hasServer: boolean
    hasWeb: boolean
}) {
    const security: string[] = []
    if (input.hasCli) {
        security.push("Shell commands should be gated by explicit confirmation before execution")
        security.push("Filesystem writes should be validated before changing tracked files")
    }
    if (input.hasServer) {
        security.push("Validate inbound API inputs and authorization boundaries")
    }
    if (input.hasWeb) {
        security.push("Sanitize user-provided content before rendering")
    }
    if (input.files.has(".env") || input.files.has(".env.local") || input.files.has(".env.production") || input.dependencyNames.has("dotenv")) {
        security.push("Environment files and secrets should be treated as protected inputs")
    }
    if (input.dependencyNames.has("zod")) {
        security.push("Structured input validation is available through Zod schemas")
    }
    return security.length ? security : undefined
}

async function existsAny(directory: string, targets: string[]) {
    for (const target of targets) {
        if (await exists(path.join(directory, target))) return true
    }
    return false
}

function readmeHeading(text: string) {
    const match = text.match(/^#\s+(.+?)\s*$/m)
    return match?.[1]?.trim()
}

function collectDependencies(pkg: Record<string, any>) {
    const deps = new Set<string>()
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const record = pkg[section]
        if (!record || typeof record !== "object") continue
        for (const key of Object.keys(record)) {
            deps.add(key)
        }
    }
    return deps
}
