/**
 * Rules Injector Hook for Navi
 *
 * Loads and injects conditional rules from various sources:
 * - .claude/rules/*.md - Claude Code rules
 * - .cursor/rules/*.md - Cursor rules
 * - .github/instructions/*.md - GitHub Copilot instructions
 * - .github/copilot-instructions.md - Copilot instructions file
 *
 * Rules are conditionally applied based on frontmatter patterns
 * that match the file being edited.
 *
 * Ported from oh-my-navi-dev plugin
 */

import type { Hooks } from "@navi-ai/plugin"
import { Log } from "@navi-ai/core/util/log"
import { promises as fs } from "node:fs"
import { join, relative, resolve, dirname } from "node:path"
import { homedir } from "node:os"

const log = Log.create({ service: "rules-injector" })

// Project root markers
const PROJECT_MARKERS = [".git", "pyproject.toml", "package.json", "Cargo.toml", "go.mod", ".venv"]

// Rule directories to search
const PROJECT_RULE_SUBDIRS: [string, string][] = [
    [".github", "instructions"],
    [".cursor", "rules"],
    [".claude", "rules"],
    [".navi", "rules"],
]

// Single file rules (always apply)
const PROJECT_RULE_FILES = [".github/copilot-instructions.md", ".navi/instructions.md"]

// Supported rule file extensions
const RULE_EXTENSIONS = [".md", ".mdc"]

/**
 * Find the project root by looking for marker files
 */
async function findProjectRoot(filePath: string): Promise<string | null> {
    let dir = dirname(filePath)
    while (dir !== dirname(dir)) {
        for (const marker of PROJECT_MARKERS) {
            try {
                await fs.access(join(dir, marker))
                return dir
            } catch (e) {
                // Ignore and try next marker
            }
        }
        dir = dirname(dir)
    }
    return null
}

/**
 * Parse frontmatter from a rule file
 */
interface RuleFrontmatter {
    description?: string
    globs?: string | string[]
    alwaysApply?: boolean
}

function parseRuleFrontmatter(content: string): { metadata: RuleFrontmatter; body: string } {
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)

    if (!frontmatterMatch) {
        return { metadata: {}, body: content }
    }

    const frontmatter = frontmatterMatch[1]
    const body = frontmatterMatch[2]

    const metadata: RuleFrontmatter = {}

    // Parse YAML-like frontmatter manually
    for (const line of frontmatter.split("\n")) {
        const match = line.match(/^(\w+):\s*(.*)$/)
        if (match) {
            const [, key, value] = match
            if (key === "description") {
                metadata.description = value.replace(/^["']|["']$/g, "")
            } else if (key === "globs") {
                const globValue = value.replace(/^["'[]|["'\]]$/g, "")
                metadata.globs = globValue.includes(",") ? globValue.split(",").map((g) => g.trim()) : globValue
            } else if (key === "alwaysApply") {
                metadata.alwaysApply = value.toLowerCase() === "true"
            }
        }
    }

    return { metadata, body }
}

/**
 * Check if a file matches a glob pattern (simple implementation)
 */
function matchGlob(pattern: string, filePath: string): boolean {
    // Convert glob to regex
    const regex = new RegExp(
        "^" +
        pattern
            .replace(/\./g, "\\.")
            .replace(/\*\*/g, ".*")
            .replace(/\*/g, "[^/]*")
            .replace(/\?/g, ".") +
        "$"
    )
    return regex.test(filePath)
}

/**
 * Check if a rule should apply to a file
 */
function shouldApplyRule(
    metadata: RuleFrontmatter,
    filePath: string,
    projectRoot: string | null
): { applies: boolean; reason?: string } {
    // Always apply if no globs or alwaysApply is true
    if (metadata.alwaysApply || !metadata.globs) {
        return { applies: true, reason: "always apply" }
    }

    const globs = Array.isArray(metadata.globs) ? metadata.globs : [metadata.globs]
    const relativePath = projectRoot ? relative(projectRoot, filePath) : filePath

    for (const glob of globs) {
        if (matchGlob(glob, relativePath)) {
            return { applies: true, reason: `matched: ${glob}` }
        }
    }

    return { applies: false }
}

/**
 * Find rule files in project and user directories
 */
async function findRuleFiles(projectRoot: string | null, userHome: string): Promise<string[]> {
    const ruleFiles: string[] = []

    if (projectRoot) {
        // Check single file rules
        for (const ruleFile of PROJECT_RULE_FILES) {
            const path = join(projectRoot, ruleFile)
            try {
                await fs.access(path)
                ruleFiles.push(path)
            } catch (e) {
                // Ignore and try next
            }
        }

        // Check rule directories
        for (const [subdir, rulesDir] of PROJECT_RULE_SUBDIRS) {
            const dir = join(projectRoot, subdir, rulesDir)
            try {
                const stat = await fs.stat(dir)
                if (stat.isDirectory()) {
                    const files = await fs.readdir(dir)
                    for (const file of files) {
                        if (RULE_EXTENSIONS.some((ext) => file.endsWith(ext))) {
                            ruleFiles.push(join(dir, file))
                        }
                    }
                }
            } catch (e) {
                // Ignore if path doesn't exist
            }
        }
    }

    // Check user-level rules (~/.claude/rules)
    const userRuleDir = join(userHome, ".claude", "rules")
    try {
        const stat = await fs.stat(userRuleDir)
        if (stat.isDirectory()) {
            const files = await fs.readdir(userRuleDir)
            for (const file of files) {
                if (RULE_EXTENSIONS.some((ext) => file.endsWith(ext))) {
                    ruleFiles.push(join(userRuleDir, file))
                }
            }
        }
    } catch (e) {
        // Ignore if path doesn't exist
    }

    return ruleFiles
}

export interface RulesInjectorOptions {
    enabled?: boolean
    maxRuleSize?: number // Max size in bytes to inject
}

/**
 * Track injected rules per session to avoid duplicates
 */
interface SessionCache {
    injectedPaths: Set<string>
    injectedHashes: Set<string>
}

const sessionCaches = new Map<string, SessionCache>()

function getSessionCache(sessionID: string): SessionCache {
    if (!sessionCaches.has(sessionID)) {
        sessionCaches.set(sessionID, {
            injectedPaths: new Set(),
            injectedHashes: new Set(),
        })
    }
    return sessionCaches.get(sessionID)!
}

/**
 * Create a simple content hash
 */
function hashContent(content: string): string {
    let hash = 0
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash
    }
    return hash.toString(36)
}

/**
 * Create the rules injector hook
 */
export function createRulesInjectorHook(options?: RulesInjectorOptions) {
    const { enabled = true, maxRuleSize = 10000 } = options ?? {}

    if (!enabled) {
        return {
            "tool.execute.after": async () => { },
            event: async () => { },
        }
    }

    const userHome = homedir()

    return {
        /**
         * Inject matching rules after file operations
         */
        "tool.execute.after": async (
            input: { tool: string; sessionID: string; callID: string },
            output: { title: string; output: string; metadata: unknown }
        ): Promise<void> => {
            const toolName = input.tool.toLowerCase()

            // Only inject for file operations
            if (!["read", "write", "edit", "multiedit"].includes(toolName)) {
                return
            }

            // Get file path from output title (typically the file path)
            const filePath = output.title
            if (!filePath || (!filePath.includes("/") && !filePath.includes("\\"))) {
                return
            }

            const resolvedPath = resolve(filePath)
            const projectRoot = await findProjectRoot(resolvedPath)
            const cache = getSessionCache(input.sessionID)

            // Find applicable rules
            const ruleFiles = await findRuleFiles(projectRoot, userHome)
            const injectedRules: { path: string; content: string; reason: string }[] = []

            for (const rulePath of ruleFiles) {
                try {
                    const realPath = await fs.realpath(rulePath)

                    // Skip if already injected
                    if (cache.injectedPaths.has(realPath)) {
                        continue
                    }

                    const content = await fs.readFile(rulePath, "utf-8")
                    const { metadata, body } = parseRuleFrontmatter(content)

                    // Check if rule applies
                    const isSingleFile = PROJECT_RULE_FILES.some((f) => rulePath.endsWith(f))
                    if (!isSingleFile) {
                        const { applies } = shouldApplyRule(metadata, resolvedPath, projectRoot)
                        if (!applies) continue
                    }

                    // Check for duplicate content
                    const hash = hashContent(body)
                    if (cache.injectedHashes.has(hash)) {
                        continue
                    }

                    // Truncate if too large
                    const truncatedBody = body.length > maxRuleSize ? body.slice(0, maxRuleSize) + "\n...(truncated)" : body

                    injectedRules.push({
                        path: rulePath,
                        content: truncatedBody,
                        reason: isSingleFile ? "always apply" : metadata.description ?? "matched",
                    })

                    cache.injectedPaths.add(realPath)
                    cache.injectedHashes.add(hash)
                } catch (e) {
                    // Skip unreadable files
                }
            }

            // Append rules to output
            if (injectedRules.length > 0) {
                log.info("Injecting rules", { count: injectedRules.length, sessionID: input.sessionID })

                for (const rule of injectedRules) {
                    const relativePath = projectRoot ? relative(projectRoot, rule.path) : rule.path
                    output.output += `\n\n[Rule: ${relativePath}]\n[Reason: ${rule.reason}]\n${rule.content}`
                }
            }
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

export default createRulesInjectorHook

