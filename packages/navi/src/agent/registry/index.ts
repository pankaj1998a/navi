import z from "zod"
import path from "path"
import fs from "fs/promises"
import { watch, type FSWatcher } from "fs"
import { Log } from "../../util/log"
import { Global } from "../../global"
import { pathToFileURL } from "url"

const log = Log.create({ service: "agent-registry" })

export const AgentDefinitionSchema = z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().optional(),
    model: z.string().or(z.object({ providerID: z.string(), modelID: z.string() })).optional(),
    toolNames: z.array(z.string()).optional().default([]),
    instructionsPrompt: z.string().min(1),
    handleSteps: z.any().optional(),
    version: z.string().default("1.0.0"),
    publisher: z.string().default("local"),
    categories: z.array(z.string()).optional(),
    hidden: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    steps: z.number().int().positive().optional(),
})

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

export interface AgentRegistryEntry {
    definition: AgentDefinition
    filePath: string
    loadedAt: number
    version: string
}

export interface AgentRegistryOptions {
    directory?: string
    autoReload?: boolean
    ttl?: number
}

export class AgentRegistry {
    private agents: Map<string, AgentRegistryEntry> = new Map()
    private staticAgents: Map<string, AgentDefinition> = new Map()
    private directory: string
    private autoReload: boolean
    private watchers: Map<string, FSWatcher> = new Map()

    constructor(options: AgentRegistryOptions = {}) {
        this.directory = options.directory ?? path.join(Global.Path.state, ".agents")
        this.autoReload = options.autoReload ?? true
    }

    async initialize(): Promise<void> {
        log.info("Initializing agent registry", { directory: this.directory })

        await this.ensureDirectory()
        await this.loadAll()

        if (this.autoReload) {
            await this.setupWatcher()
        }
    }

    private async ensureDirectory(): Promise<void> {
        try {
            await fs.mkdir(this.directory, { recursive: true })
            log.info("Created agents directory", { directory: this.directory })
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error
            }
        }
    }

    async loadAll(): Promise<void> {
        log.info("Loading all agents from registry")

        const files = await this.findAgentFiles(this.directory)

        for (const file of files) {
            try {
                await this.loadAgent(file)
            } catch (error) {
                log.error("Failed to load agent", { file, error })
            }
        }

        log.info("Loaded agents", { count: this.agents.size })
    }

    private async findAgentFiles(directory: string): Promise<string[]> {
        const files: string[] = []

        try {
            const entries = await fs.readdir(directory, { withFileTypes: true })

            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name)

                if (entry.isDirectory()) {
                    const subFiles = await this.findAgentFiles(fullPath)
                    files.push(...subFiles)
                } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
                    files.push(fullPath)
                }
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error
            }
        }

        return files
    }

    private async loadAgent(filePath: string): Promise<void> {
        log.info("Loading agent", { filePath })

        try {
            // Use dynamic import to load the agent definition
            // Add a timestamp to bypass the module cache if autoReload is enabled
            const fetchUrl = process.platform === "win32" 
                ? pathToFileURL(filePath).href 
                : filePath
            
            const cacheBuster = this.autoReload ? `?t=${Date.now()}` : ""
            const mod = await import(fetchUrl + cacheBuster)
            const definition = mod.default
            
            if (!definition) {
                log.warn("No default export found in agent file", { filePath })
                return
            }

            const parsed = AgentDefinitionSchema.parse(definition)
            const fullId = this.getFullId(parsed)

            const entry: AgentRegistryEntry = {
                definition: parsed,
                filePath,
                loadedAt: Date.now(),
                version: parsed.version,
            }

            this.agents.set(fullId, entry)
            log.info("Loaded agent", { id: fullId, displayName: parsed.displayName })
        } catch (error) {
            log.error("Failed to load agent definition", { filePath, error })
            
            // Fallback to regex parsing if import fails (e.g. syntax error in file)
            const content = await fs.readFile(filePath, 'utf-8')
            const definition = this.parseAgentDefinitionFallback(content, filePath)
            if (definition) {
                const fullId = this.getFullId(definition)
                this.agents.set(fullId, {
                    definition,
                    filePath,
                    loadedAt: Date.now(),
                    version: definition.version
                })
            }
        }
    }

    private parseAgentDefinitionFallback(content: string, filePath: string): AgentDefinition | null {
        // Look for export default statement
        const defaultExportMatch = content.match(/export\s+default\s+(\{[\s\S]*?\})\s*;?/)

        if (defaultExportMatch) {
            try {
                // Simple parsing - in real implementation, would use a proper parser
                const jsonStr = defaultExportMatch[1]
                    .replace(/\/\/.*$/gm, '') // Remove single-line comments
                    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
                    .replace(/'(\w+)':/g, '"$1":') // Convert single quotes to double quotes
                    .replace(/'/g, '"') // Replace remaining single quotes

                const parsed = JSON.parse(jsonStr)
                return AgentDefinitionSchema.parse(parsed)
            } catch (error) {
                log.warn("Failed to parse agent definition fallback", { filePath, error })
                return null
            }
        }

        return null
    }

    private getFullId(definition: AgentDefinition): string {
        return `${definition.publisher}/${definition.id}@${definition.version}`
    }

    private async setupWatcher(): Promise<void> {
        log.info("Setting up file watcher", { directory: this.directory })

        try {
            const watcher = watch(this.directory, { recursive: true }, async (eventType: string, filename: string | null) => {
                if (!filename) return

                const filePath = path.join(this.directory, filename)

                // Debounce reloads
                setTimeout(async () => {
                    if (eventType === 'change') {
                        await this.reloadAgent(filePath)
                    } else if (eventType === 'rename') {
                        // renamed can be add or delete
                        // for simplicity check if file exists
                        try {
                            await fs.access(filePath)
                            await this.reloadAgent(filePath)
                        } catch {
                            this.removeAgent(filePath)
                        }
                    }
                }, 100)
            })

            this.watchers.set(this.directory, watcher)
        } catch (error) {
            log.warn("Failed to setup file watcher", { error })
        }
    }

    async reloadAgent(filePath: string): Promise<void> {
        log.info("Reloading agent", { filePath })

        // Remove old entry
        this.removeAgent(filePath)

        // Load new entry
        await this.loadAgent(filePath)
    }

    private removeAgent(filePath: string): void {
        for (const [id, entry] of this.agents.entries()) {
            if (entry.filePath === filePath) {
                this.agents.delete(id)
                log.info("Removed agent", { id })
            }
        }
    }

    async get(agentId: string): Promise<AgentDefinition | null> {
        return this.getSync(agentId)
    }

    getSync(agentId: string): AgentDefinition | null {
        // Try static agents first
        if (this.staticAgents.has(agentId)) {
            return this.staticAgents.get(agentId)!
        }

        // Try exact match first
        if (this.agents.has(agentId)) {
            return this.agents.get(agentId)!.definition
        }

        // Try without version (e.g. system/agent)
        for (const [id, entry] of this.agents.entries()) {
            if (id.startsWith(agentId + '@')) {
                return entry.definition
            }
        }

        // Try just by ID (if not qualified)
        for (const [id, entry] of this.agents.entries()) {
            if (id.includes('/' + agentId + '@')) {
                return entry.definition
            }
        }

        return null
    }

    async list(options?: {
        publisher?: string
        category?: string
        hidden?: boolean
    }): Promise<AgentDefinition[]> {
        const fileAgents = Array.from(this.agents.values()).map(a => a.definition)
        const staticAgents = Array.from(this.staticAgents.values())
        let agents = [...fileAgents, ...staticAgents]

        if (options?.publisher) {
            agents = agents.filter(a => a.publisher === options.publisher)
        }

        if (options?.category) {
            agents = agents.filter(a => a.categories?.includes(options.category!))
        }

        if (options?.hidden !== undefined) {
            agents = agents.filter(a => a.hidden === options.hidden)
        }

        return agents
    }

    async listAll(): Promise<AgentDefinition[]> {
        const fileAgents = Array.from(this.agents.values()).map(a => a.definition)
        const staticAgents = Array.from(this.staticAgents.values())
        return [...fileAgents, ...staticAgents]
    }

    async publish(agent: AgentDefinition): Promise<void> {
        const fullId = this.getFullId(agent)

        const entry: AgentRegistryEntry = {
            definition: agent,
            filePath: path.join(this.directory, `${agent.id}.ts`),
            loadedAt: Date.now(),
            version: agent.version,
        }

        this.agents.set(fullId, entry)

        // Write to file
        const fileContent = this.generateAgentFile(agent)
        await fs.writeFile(entry.filePath, fileContent, 'utf-8')

        log.info("Published agent", { id: fullId })
    }

    private generateAgentFile(agent: AgentDefinition): string {
        return `export default {
  id: '${agent.id}',
  displayName: '${agent.displayName}',
  ${agent.description ? `description: '${agent.description}',` : ''}
  model: '${agent.model}',
  toolNames: ${JSON.stringify(agent.toolNames)},
  instructionsPrompt: \`${agent.instructionsPrompt}\`,
  ${agent.handleSteps ? `handleSteps: ${agent.handleSteps.toString()},` : ''}
  version: '${agent.version}',
  publisher: '${agent.publisher}',
  ${agent.categories ? `categories: ${JSON.stringify(agent.categories)},` : ''}
  ${agent.hidden ? `hidden: ${agent.hidden},` : ''}
  ${agent.temperature !== undefined ? `temperature: ${agent.temperature},` : ''}
  ${agent.topP !== undefined ? `topP: ${agent.topP},` : ''}
}
`
    }

    async unpublish(agentId: string): Promise<void> {
        const entry = this.agents.get(agentId)
        if (entry) {
            this.agents.delete(agentId)

            // Remove file
            try {
                await fs.unlink(entry.filePath)
                log.info("Unpublished agent", { agentId })
            } catch (error) {
                log.warn("Failed to remove agent file", { agentId, error })
            }
        }
    }

    async reload(): Promise<void> {
        log.info("Reloading all agents")

        // Clear existing agents
        this.agents.clear()

        // Stop watchers
        for (const watcher of this.watchers.values()) {
            watcher.close()
        }
        this.watchers.clear()

        // Reload all
        await this.loadAll()

        // Restart watchers
        if (this.autoReload) {
            await this.setupWatcher()
        }

        log.info("Reload complete", { count: this.agents.size })
    }

    async dispose(): Promise<void> {
        // Close all watchers
        for (const watcher of this.watchers.values()) {
            watcher.close()
        }
        this.watchers.clear()

        // Clear agents
        this.agents.clear()
        this.staticAgents.clear()

        log.info("Disposed agent registry")
    }

    registerStatic(definition: AgentDefinition): void {
        const fullId = this.getFullId(definition)
        this.staticAgents.set(fullId, definition)
        log.debug("Registered static agent", { id: fullId })
    }
}

export const Registry = new AgentRegistry()


