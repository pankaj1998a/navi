/**
 * Directory AGENTS.md Injector Hook for Navi
 *
 * Automatically injects context from AGENTS.md files when reading files.
 * AGENTS.md files contain directory-specific context and guidelines
 * that help agents understand the purpose and conventions of each directory.
 *
 * Features:
 * - Walks up from file to project root
 * - Injects all AGENTS.md files found along the path
 * - Caches injections per session to avoid duplicates
 * - Also supports README.md injection
 *
 * Ported from oh-my-navi-dev plugin
 */

import type { Hooks } from "@navi-ai/plugin"
import { Log } from "@navi-ai/core/util/log"
import { promises as fs } from "node:fs"
import { dirname, join, resolve } from "node:path"

const log = Log.create({ service: "directory-agents-injector" })

// Files to inject (in order of preference)
const CONTEXT_FILES = ["AGENTS.md", "CONVENTIONS.md", "README.md"]

// Max content to inject per file
const MAX_CONTENT_SIZE = 8000

/**
 * Track injected directories per session
 */
const sessionCaches = new Map<string, Set<string>>()

function getSessionCache(sessionID: string): Set<string> {
    if (!sessionCaches.has(sessionID)) {
        sessionCaches.set(sessionID, new Set())
    }
    return sessionCaches.get(sessionID)!
}

/**
 * Find project root markers
 */
const PROJECT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"]

async function exists(path: string): Promise<boolean> {
    try {
        await fs.access(path)
        return true
    } catch (e) {
        // Return false if path does not exist or is not accessible
        return false
    }
}

async function findProjectRoot(startDir: string): Promise<string | null> {
    let dir = startDir
    while (dir !== dirname(dir)) {
        for (const marker of PROJECT_MARKERS) {
            if (await exists(join(dir, marker))) {
                return dir
            }
        }
        dir = dirname(dir)
    }
    return null
}

/**
 * Find context files walking up from a directory
 */
async function findContextFilesUp(startDir: string, projectRoot: string | null): Promise<string[]> {
    const found: string[] = []
    let current = startDir

    while (true) {
        // Check for context files
        for (const filename of CONTEXT_FILES) {
            const path = join(current, filename)
            if (await exists(path)) {
                found.push(path)
                break // Only inject one file per directory
            }
        }

        // Stop at project root or if we've left the project
        if (!projectRoot || current === projectRoot) break
        const parent = dirname(current)
        if (parent === current) break
        if (!parent.startsWith(projectRoot)) break
        current = parent
    }

    // Reverse so we inject from root to leaf
    return found.reverse()
}

export interface DirectoryAgentsInjectorOptions {
    enabled?: boolean
    includeReadme?: boolean
    maxContentSize?: number
}

/**
 * Create the directory agents injector hook
 */
export function createDirectoryAgentsInjectorHook(options?: DirectoryAgentsInjectorOptions) {
    const { enabled = true, includeReadme = false, maxContentSize = MAX_CONTENT_SIZE } = options ?? {}

    if (!enabled) {
        return {
            "tool.execute.after": async () => { },
            event: async () => { },
        }
    }

    // Build list of files to check
    const contextFiles = includeReadme ? CONTEXT_FILES : CONTEXT_FILES.filter((f) => f !== "README.md")

    /**
     * Process a file path and inject context files
     */
    async function processFilePathForInjection(
        filePath: string,
        sessionID: string,
        output: { output: string },
        cwd: string
    ): Promise<void> {
        // Resolve the file path
        const resolved = filePath.startsWith("/") ? filePath : resolve(cwd, filePath)
        if (!(await exists(resolved))) return

        const dir = dirname(resolved)
        const projectRoot = await findProjectRoot(dir)
        const cache = getSessionCache(sessionID)

        // Find context files up the directory tree
        const contextPaths: string[] = []
        let current = dir

        while (true) {
            // Skip if already injected for this directory
            if (!cache.has(current)) {
                for (const filename of contextFiles) {
                    const path = join(current, filename)
                    if (await exists(path)) {
                        contextPaths.push(path)
                        cache.add(current)
                        break
                    }
                }
            }

            if (!projectRoot || current === projectRoot) break
            const parent = dirname(current)
            if (parent === current) break
            if (!parent.startsWith(projectRoot)) break
            current = parent
        }

        // Inject found context files (from root to leaf)
        const reversedPaths = contextPaths.reverse()
        for (const contextPath of reversedPaths) {
            try {
                let content = await fs.readFile(contextPath, "utf-8")

                // Truncate if too large
                if (content.length > maxContentSize) {
                    content = content.slice(0, maxContentSize) + "\n\n...(truncated)"
                }

                output.output += `\n\n[Directory Context: ${contextPath}]\n${content}`
                log.info("Injected directory context", { path: contextPath, sessionID })
            } catch (e: any) {
                // Skip unreadable files
                log.warn("Failed to read directory context file", { path: contextPath, error: e.message })
            }
        }
    }

    return {
        /**
         * Inject context after file read operations
         */
        "tool.execute.after": async (
            input: { tool: string; sessionID: string; callID: string },
            output: { title: string; output: string; metadata: unknown }
        ): Promise<void> => {
            const toolName = input.tool.toLowerCase()

            // Only inject for read tool
            if (toolName !== "read") {
                return
            }

            // Get file path from title (typically the file path for read tool)
            const filePath = output.title
            if (!filePath) return

            await processFilePathForInjection(filePath, input.sessionID, output, process.cwd())
        },

        /**
         * Clean up session cache on deletion/compaction
         */
        event: async (input: { event: { type: string; properties?: unknown } }): Promise<void> => {
            const props = input.event.properties as Record<string, unknown> | undefined

            if (input.event.type === "session.deleted" || input.event.type === "session.compacted") {
                const sessionID =
                    (props?.sessionID as string) ?? ((props?.info as { id?: string })?.id as string)
                if (sessionID) {
                    sessionCaches.delete(sessionID)
                }
            }
        },
    }
}

export default createDirectoryAgentsInjectorHook

