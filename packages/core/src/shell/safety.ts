import { BashArity } from "@/permission/arity"

export type CommandRisk = "low" | "medium" | "high" | "critical"

export interface CommandAnalysis {
    command: string
    summary: string
    risk: CommandRisk
    destructive: boolean
    readOnly: boolean
    warnings: string[]
}

/**
 * CommandSafety provides deeper analysis of shell commands 
 * to enforce "Plan Mode" and general user safety.
 */
export class CommandSafety {
    private static READ_ONLY_COMMANDS = new Set([
        "ls", "dir", "grep", "cat", "more", "less", "head", "tail", "wc", "find", 
        "git status", "git log", "git diff", "git show", "git branch", "git remote",
        "npm list", "pip list", "bun list", "pwd", "whoami", "id", "hostname",
        "df", "du", "free", "uptime", "uname"
    ])

    private static DESTRUCTIVE_PATTERNS = [
        /rm\s+/i, /rmdir\s+/i, /git\s+clean\s+.*-f/i, /git\s+reset\s+.*--hard/i,
        /git\s+push\s+.*--force/i, /dd\s+/i, /mkfs/i, /shutdown/i, /reboot/i,
        />\s*\S+/, // Output redirection
        /\|\s*sudo/i // Piped to sudo
    ]

    static analyze(command: string): CommandAnalysis {
        const normalized = command.trim()
        const tokens = normalized.split(/\s+/).filter(Boolean)
        const commandName = BashArity.prefix(tokens).join(" ") || tokens[0] || normalized
        const lower = normalized.toLowerCase()
        const warnings: string[] = []

        let risk: CommandRisk = "low"
        let destructive = false
        let readOnly = false
        let summary = commandName

        // 1. Check for basic Read-Only attribution
        if (this.READ_ONLY_COMMANDS.has(commandName) || this.READ_ONLY_COMMANDS.has(tokens[0])) {
            readOnly = true
            // But check for redirection which makes it destructive
            if (/>+/.test(normalized)) {
                readOnly = false
                destructive = true
                risk = "high"
                warnings.push("Read-only command redirected to file (writes detected)")
            }
        }

        // 2. Check for destructive patterns
        if (this.DESTRUCTIVE_PATTERNS.some(p => p.test(normalized))) {
            risk = "critical"
            destructive = true
            summary = `destructive command: ${commandName}`
            warnings.push("Can delete, overwrite, or irreversibly change files or system state")
        } 
        // 3. Movement/Edit operations
        else if (/^(mv|cp|mkdir|touch|chmod|chown)\b/i.test(lower) || /^git\s+(commit|merge|rebase|am|tag)\b/i.test(lower)) {
            risk = "high"
            destructive = true
            summary = `filesystem change: ${commandName}`
            warnings.push("Will modify project files or repository state")
        } 
        // 4. Dependency/Workflow changes
        else if (/^(?:bun|npm|pnpm|yarn|pip|poetry|cargo|go|mvn|gradle)\s+(?:install|add|update|upgrade)\b/i.test(lower)) {
            risk = "medium"
            summary = `dependency install: ${commandName}`
            warnings.push("May update lockfiles, downloaded packages, or dependency state")
        }

        return {
            command: commandName,
            summary,
            risk,
            destructive,
            readOnly,
            warnings,
        }
    }

    /**
     * returns true if the command is considered safe for "Plan Mode"
     */
    static isSafeForPlan(command: string): boolean {
        const analysis = this.analyze(command)
        return analysis.readOnly && !analysis.destructive
    }
}


