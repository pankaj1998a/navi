import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { AgentManifest } from "./manifest"
import { Log } from "../util/log"

const log = Log.create({ service: "agent-store" })

export class AgentStore {
    static get root() {
        return path.join(Global.Path.data, "agents")
    }

    static async init() {
        await fs.mkdir(this.root, { recursive: true })
    }

    /**
     * List all installed agents
     */
    static async list(): Promise<AgentManifest[]> {
        await this.init()
        const agents: AgentManifest[] = []

        let authors: string[] = []
        try {
            authors = await fs.readdir(this.root)
        } catch (e) {
            return []
        }

        for (const author of authors) {
            if (author.startsWith(".")) continue
            const authorPath = path.join(this.root, author)

            try {
                const stat = await fs.stat(authorPath)
                if (!stat.isDirectory()) continue

                const agentNames = await fs.readdir(authorPath)
                for (const name of agentNames) {
                    if (name.startsWith(".")) continue
                    const manifestPath = path.join(authorPath, name, "manifest.json")
                    try {
                        // Check if file exists
                        await fs.access(manifestPath)
                        const content = await fs.readFile(manifestPath, "utf-8")
                        const json = JSON.parse(content)
                        const manifest = AgentManifest.parse(json)
                        agents.push(manifest)
                    } catch (e) {
                        log.error(`Failed to load agent manifest at ${manifestPath}`, { error: e })
                    }
                }
            } catch (e) {
                log.warn(`Failed to process author directory ${authorPath}`, { error: e })
            }
        }

        return agents
    }

    /**
     * Install an agent from a manifest
     */
    static async install(manifest: AgentManifest) {
        await this.init()
        const [author, name] = manifest.name.split("/")
        const installDir = path.join(this.root, author, name)

        await fs.mkdir(installDir, { recursive: true })
        await fs.writeFile(path.join(installDir, "manifest.json"), JSON.stringify(manifest, null, 2))

        log.info(`Installed agent ${manifest.name} v${manifest.version}`)
        return installDir
    }

    /**
     * Uninstall an agent
     */
    static async uninstall(name: string) {
        await this.init()
        const [author, agentName] = name.split("/")
        const dir = path.join(this.root, author, agentName)

        try {
            await fs.access(dir)
            await fs.rm(dir, { recursive: true, force: true })

            // Remove author dir if empty
            const authorDir = path.join(this.root, author)
            const contents = await fs.readdir(authorDir)
            if (contents.length === 0) {
                await fs.rm(authorDir, { recursive: true, force: true })
            }

            log.info(`Uninstalled agent ${name}`)
            return true
        } catch (e) {
            return false
        }
    }

    /**
     * Fetch manifest from a source
     * For MVP, supports:
     * - URL (http/https)
     * - Local file path
     * - "author/name" (Mock registry lookup)
     */
    static async fetch(source: string): Promise<AgentManifest> {
        // 1. URL
        if (source.startsWith("http")) {
            const response = await fetch(source)
            if (!response.ok) throw new Error(`Failed to fetch agent: ${response.statusText}`)
            const json = await response.json()
            return AgentManifest.parse(json)
        }

        // 2. Local File
        if (source.endsWith(".json") && (source.startsWith("/") || source.startsWith(".") || source.includes(":\\"))) {
            const content = await fs.readFile(source, "utf-8")
            const json = JSON.parse(content)
            return AgentManifest.parse(json)
        }

        // 3. Registry Lookup (Mock)
        if (source.match(/^[a-z0-9-]+\/[a-z0-9-]+$/)) {
            // TODO: Implement actual registry
            if (source === "navi/demo") {
                return {
                    name: "navi/demo",
                    version: "1.0.0",
                    description: "A demo agent from the store",
                    author: "Navi Team",
                    license: "MIT",
                    tags: ["demo"],
                    config: {
                        name: "demo",
                        mode: "primary",
                        prompt: "You are a demo agent. Be helpful.",
                        options: {},
                        permission: []
                    }
                }
            }
            throw new Error(`Agent ${source} not found in registry (Registry is not yet implemented)`)
        }

        throw new Error(`Invalid agent source: ${source}`)
    }
}


