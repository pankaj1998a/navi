/**
 * Bash Command Validator
 *
 * Uses bash-parser to create a proper AST and validate commands in Explore mode.
 */

import bashParser from "bash-parser"
import { Log } from "../util/log"
import type { CompiledBashPattern } from "./mode-types"

const log = Log.create({ service: "bash-validator" })

// ============================================================
// Types
// ============================================================

export interface BashValidationResult {
    allowed: boolean
    reason?: BashValidationReason
    subcommandResults?: SubcommandResult[]
}

export interface SubcommandResult {
    command: string
    allowed: boolean
    reason?: string
}

export type BashValidationReason =
    | { type: "pipeline"; explanation: string }
    | { type: "redirect"; op: string; explanation: string }
    | { type: "command_expansion"; explanation: string }
    | { type: "process_substitution"; explanation: string }
    | { type: "unsafe_command"; command: string; explanation: string }
    | { type: "parse_error"; error: string }
    | { type: "compound_partial_fail"; failedCommands: string[]; passedCommands: string[] }
    | { type: "background_execution"; explanation: string }

// ============================================================
// AST Node Types (from bash-parser)
// ============================================================

interface ASTNode {
    type: string
}

interface WordNode extends ASTNode {
    type: "Word"
    text: string
    expansion?: ExpansionNode[]
}

interface CommandNode extends ASTNode {
    type: "Command"
    name?: WordNode
    prefix?: ASTNode[]
    suffix?: ASTNode[]
    async?: boolean
}

interface LogicalExpressionNode extends ASTNode {
    type: "LogicalExpression"
    op: "and" | "or"
    left: ASTNode
    right: ASTNode
}

interface PipelineNode extends ASTNode {
    type: "Pipeline"
    commands: ASTNode[]
}

interface SubshellNode extends ASTNode {
    type: "Subshell"
    list: CompoundListNode
}

interface CompoundListNode extends ASTNode {
    type: "CompoundList"
    commands: ASTNode[]
}

interface RedirectNode extends ASTNode {
    type: "Redirect"
    op: { text: string; type: string }
    file: WordNode
}

interface ExpansionNode {
    type: string
    command?: string
    commandAST?: ScriptNode
}

interface ScriptNode extends ASTNode {
    type: "Script"
    commands: ASTNode[]
}

// ============================================================
// Validation Logic
// ============================================================

export function validateBashCommand(command: string, patterns: CompiledBashPattern[]): BashValidationResult {
    let ast: ScriptNode
    try {
        ast = bashParser(command) as ScriptNode
    } catch (error) {
        log.error("Parse error", { error })
        return {
            allowed: false,
            reason: {
                type: "parse_error",
                error: error instanceof Error ? error.message : String(error),
            },
        }
    }

    const subcommandResults: SubcommandResult[] = []
    const result = validateNode(ast, patterns, subcommandResults)

    return {
        ...result,
        subcommandResults: subcommandResults.length > 0 ? subcommandResults : undefined,
    }
}

function validateNode(node: ASTNode, patterns: CompiledBashPattern[], results: SubcommandResult[]): BashValidationResult {
    switch (node.type) {
        case "Script":
            return validateScript(node as ScriptNode, patterns, results)
        case "Command":
            return validateCommand(node as CommandNode, patterns, results)
        case "LogicalExpression":
            return validateLogicalExpression(node as LogicalExpressionNode, patterns, results)
        case "Pipeline":
            return validatePipeline(node as PipelineNode, patterns, results)
        case "Subshell":
            return validateSubshell(node as SubshellNode, patterns, results)
        case "CompoundList":
            return validateCompoundList(node as CompoundListNode, patterns, results)
        default:
            log.debug("Unknown node type", { type: node.type })
            return { allowed: true }
    }
}

function validateScript(node: ScriptNode, patterns: CompiledBashPattern[], results: SubcommandResult[]): BashValidationResult {
    for (const cmd of node.commands) {
        const result = validateNode(cmd, patterns, results)
        if (!result.allowed) return result
    }
    return { allowed: true }
}

function validateCommand(node: CommandNode, patterns: CompiledBashPattern[], results: SubcommandResult[]): BashValidationResult {
    if (node.async) {
        return {
            allowed: false,
            reason: {
                type: "background_execution",
                explanation: "Background execution (&) is blocked",
            },
        }
    }

    const commandParts: string[] = []

    if (node.name) {
        const expansionCheck = checkWordForExpansions(node.name)
        if (expansionCheck) return { allowed: false, reason: expansionCheck }
        commandParts.push(node.name.text)
    }

    if (node.prefix) {
        for (const item of node.prefix) {
            if (item.type === "Redirect") {
                const redirect = item as RedirectNode
                return {
                    allowed: false,
                    reason: {
                        type: "redirect",
                        op: redirect.op.text,
                        explanation: getRedirectExplanation(redirect.op.text),
                    },
                }
            }
        }
    }

    if (node.suffix) {
        for (const item of node.suffix) {
            if (item.type === "Redirect") {
                const redirect = item as RedirectNode
                return {
                    allowed: false,
                    reason: {
                        type: "redirect",
                        op: redirect.op.text,
                        explanation: getRedirectExplanation(redirect.op.text),
                    },
                }
            }

            if (item.type === "Word") {
                const word = item as WordNode
                const expansionCheck = checkWordForExpansions(word)
                if (expansionCheck) return { allowed: false, reason: expansionCheck }
                commandParts.push(word.text)
            }
        }
    }

    const commandStr = commandParts.join(" ")
    const matchesPattern = patterns.some((pattern) => pattern.regex.test(commandStr))

    results.push({
        command: commandStr,
        allowed: matchesPattern,
        reason: matchesPattern ? undefined : "Not in allowlist",
    })

    if (!matchesPattern) {
        return {
            allowed: false,
            reason: {
                type: "unsafe_command",
                command: commandStr,
                explanation: "Command is not in the read-only allowlist",
            },
        }
    }

    return { allowed: true }
}

function validateLogicalExpression(
    node: LogicalExpressionNode,
    patterns: CompiledBashPattern[],
    results: SubcommandResult[],
): BashValidationResult {
    const leftResult = validateNode(node.left, patterns, results)
    if (!leftResult.allowed) return leftResult

    const rightResult = validateNode(node.right, patterns, results)
    if (!rightResult.allowed) return rightResult

    return { allowed: true }
}

function validatePipeline(node: PipelineNode, patterns: CompiledBashPattern[], results: SubcommandResult[]): BashValidationResult {
    for (const cmd of node.commands) {
        const result = validateNode(cmd, patterns, results)
        if (!result.allowed) return result
    }
    return { allowed: true }
}

function validateSubshell(node: SubshellNode, patterns: CompiledBashPattern[], results: SubcommandResult[]): BashValidationResult {
    return validateNode(node.list, patterns, results)
}

function validateCompoundList(node: CompoundListNode, patterns: CompiledBashPattern[], results: SubcommandResult[]): BashValidationResult {
    for (const cmd of node.commands) {
        const result = validateNode(cmd, patterns, results)
        if (!result.allowed) return result
    }
    return { allowed: true }
}

function checkWordForExpansions(word: WordNode): BashValidationReason | null {
    if (!word.expansion) return null

    for (const exp of word.expansion) {
        if (exp.type === "CommandExpansion") {
            return {
                type: "command_expansion",
                explanation: `Command substitution $(...) is blocked (found in: ${word.text})`,
            }
        }
        if (exp.type === "ProcessSubstitution") {
            return {
                type: "process_substitution",
                explanation: `Process substitution is blocked (found in: ${word.text})`,
            }
        }
    }

    return null
}

function getRedirectExplanation(op: string): string {
    const explanations: Record<string, string> = {
        ">": "overwrites file contents",
        ">>": "appends to file",
        "<": "reads from file",
        ">&": "redirects file descriptors",
        "<&": "duplicates input file descriptors",
        ">|": "forces overwrite",
        "<<": "here-document is blocked",
        "<<<": "here-string is blocked",
    }

    return explanations[op] || `redirect operator "${op}" is blocked`
}

export function hasControlCharacters(command: string): { char: string; explanation: string } | null {
    const dangerous: Record<string, string> = {
        "\n": "Newline acts as command separator in bash",
        "\r": "Carriage return can act as command separator",
        "\x00": "Null byte can truncate strings unexpectedly",
    }

    for (const char of command) {
        if (dangerous[char]) {
            const displayChar = char === "\n" ? "\\n" : char === "\r" ? "\\r" : "\\0"
            return { char: displayChar, explanation: dangerous[char] }
        }
    }

    return null
}



