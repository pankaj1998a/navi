import * as fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"

export interface FallbackPosition {
  file: string
  line: number // 0-based
  character: number // 0-based
}

export interface FallbackRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

export interface FallbackSymbol {
  name: string
  kind: string
  containerName?: string
  range: FallbackRange
  selectionRange?: FallbackRange
}

export interface FallbackLocation {
  uri: string
  range: FallbackRange
}

export interface FallbackHover {
  contents: {
    kind: "markdown"
    value: string
  }
  range?: FallbackRange
}

/**
 * Extracts the token/word under cursor at (line, character).
 */
export function getWordAtPosition(content: string, line: number, character: number): string | null {
  const lines = content.split(/\r?\n/)
  if (line < 0 || line >= lines.length) return null
  const lineStr = lines[line] || ""
  if (character < 0 || character > lineStr.length) return null

  // Find word boundary [a-zA-Z0-9_$]
  const isWordChar = (c: string) => /[a-zA-Z0-9_$]/.test(c)
  let start = character
  while (start > 0 && isWordChar(lineStr[start - 1] || "")) {
    start--
  }
  let end = character
  while (end < lineStr.length && isWordChar(lineStr[end] || "")) {
    end++
  }

  const word = lineStr.slice(start, end)
  return word.length > 0 ? word : null
}

const DEF_PATTERNS = [
  // TS/JS/Rust/Go/Python function and method definitions
  /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/,
  /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/,
  /^(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)/,
  /^(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/,
  /^(?:export\s+)?type\s+([a-zA-Z0-9_$]+)\s*=/,
  /^(?:export\s+)?enum\s+([a-zA-Z0-9_$]+)/,
  /^\s*(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)/, // Rust
  /^\s*(?:pub\s+)?struct\s+([a-zA-Z0-9_]+)/, // Rust
  /^\s*(?:pub\s+)?enum\s+([a-zA-Z0-9_]+)/, // Rust
  /^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)/, // Go
  /^\s*type\s+([a-zA-Z0-9_]+)\s+struct/, // Go
  /^\s*(?:async\s+)?def\s+([a-zA-Z0-9_]+)/, // Python
  /^\s*class\s+([a-zA-Z0-9_]+)/, // Python
]

export function extractDocumentSymbols(content: string, uri: string): FallbackSymbol[] {
  const symbols: FallbackSymbol[] = []
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] || ""
    const line = rawLine.trim()

    for (const pattern of DEF_PATTERNS) {
      const match = line.match(pattern)
      if (match && match[1]) {
        const name = match[1]
        const colStart = rawLine.indexOf(name)
        const colEnd = colStart >= 0 ? colStart + name.length : line.length

        let kind = "function"
        if (/class/.test(line)) kind = "class"
        else if (/interface/.test(line)) kind = "interface"
        else if (/struct/.test(line)) kind = "struct"
        else if (/enum/.test(line)) kind = "enum"
        else if (/type/.test(line)) kind = "type"

        symbols.push({
          name,
          kind,
          range: {
            start: { line: i, character: 0 },
            end: { line: i, character: rawLine.length },
          },
          selectionRange: {
            start: { line: i, character: Math.max(0, colStart) },
            end: { line: i, character: colEnd },
          },
        })
        break
      }
    }
  }

  return symbols
}

export async function fallbackGoToDefinition(
  file: string,
  pos: FallbackPosition,
): Promise<FallbackLocation[]> {
  try {
    const content = await fs.readFile(file, "utf8")
    const word = getWordAtPosition(content, pos.line, pos.character)
    if (!word) return []

    const uri = pathToFileURL(file).href
    const lines = content.split(/\r?\n/)
    const results: FallbackLocation[] = []

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i] || ""
      for (const pattern of DEF_PATTERNS) {
        const match = rawLine.trim().match(pattern)
        if (match && match[1] === word) {
          const col = rawLine.indexOf(word)
          results.push({
            uri,
            range: {
              start: { line: i, character: Math.max(0, col) },
              end: { line: i, character: Math.max(0, col) + word.length },
            },
          })
        }
      }
    }

    return results
  } catch {
    return []
  }
}

export async function fallbackFindReferences(
  file: string,
  pos: FallbackPosition,
): Promise<FallbackLocation[]> {
  try {
    const content = await fs.readFile(file, "utf8")
    if (content.length > 2_000_000) return []
    const word = (getWordAtPosition(content, pos.line, pos.character) || "").slice(0, 256)
    if (!word) return []

    const uri = pathToFileURL(file).href
    const lines = content.split(/\r?\n/)
    const results: FallbackLocation[] = []
    const regex = new RegExp(`\\b${word}\\b`, "g")

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i] || ""
      let match: RegExpExecArray | null
      while ((match = regex.exec(rawLine)) !== null) {
        results.push({
          uri,
          range: {
            start: { line: i, character: match.index },
            end: { line: i, character: match.index + word.length },
          },
        })
      }
    }

    return results
  } catch {
    return []
  }
}

export async function fallbackHover(
  file: string,
  pos: FallbackPosition,
): Promise<FallbackHover[]> {
  try {
    const content = await fs.readFile(file, "utf8")
    const word = getWordAtPosition(content, pos.line, pos.character)
    if (!word) return []

    const lines = content.split(/\r?\n/)
    let declLine = -1
    let signature = ""

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i] || ""
      for (const pattern of DEF_PATTERNS) {
        const match = rawLine.trim().match(pattern)
        if (match && match[1] === word) {
          declLine = i
          signature = rawLine.trim()
          break
        }
      }
      if (declLine >= 0) break
    }

    if (declLine === -1) {
      return [
        {
          contents: {
            kind: "markdown",
            value: `\`${word}\` (zero-LSP in-memory symbol)`,
          },
        },
      ]
    }

    // Grab docstrings/comments immediately preceding declaration
    const docs: string[] = []
    let p = declLine - 1
    while (p >= 0 && (lines[p]!.trim().startsWith("//") || lines[p]!.trim().startsWith("*") || lines[p]!.trim().startsWith("/*") || lines[p]!.trim().startsWith("#"))) {
      docs.unshift(lines[p]!.trim())
      p--
    }

    const docStr = docs.length > 0 ? `\n\n${docs.join("\n")}` : ""
    return [
      {
        contents: {
          kind: "markdown",
          value: `\`\`\`typescript\n${signature}\n\`\`\`${docStr}\n\n*(zero-LSP lexical scope fallback)*`,
        },
        range: {
          start: { line: declLine, character: 0 },
          end: { line: declLine, character: signature.length },
        },
      },
    ]
  } catch {
    return []
  }
}
