#!/usr/bin/env bun
/**
 * docs-list.ts
 *
 * Walks documentation directories (e.g. docs/) in the project and indexes
 * markdown files with their YAML frontmatter:
 * - summary: short summary of what the doc covers
 * - read_when: triggers / conditions when an AI agent should read this doc
 *
 * Inspired by steipete/agent-scripts/scripts/docs-list.ts
 */
import fs from "fs"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../")
const targetDocsDir = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.join(repoRoot, "docs")

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "archive", "dist", ".turbo"])

interface DocEntry {
  file: string
  summary: string | null
  readWhen: string[]
  error?: string
}

function walkMarkdownFiles(dir: string, base: string = dir): string[] {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue
      files.push(...walkMarkdownFiles(fullPath, base))
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.relative(base, fullPath))
    }
  }

  return files.sort()
}

function extractDocMetadata(fullPath: string): { summary: string | null; readWhen: string[]; error?: string } {
  const content = fs.readFileSync(fullPath, "utf8")
  if (!content.startsWith("---")) {
    return { summary: null, readWhen: [] }
  }

  const endIdx = content.indexOf("\n---", 3)
  if (endIdx === -1) {
    return { summary: null, readWhen: [], error: "Unterminated frontmatter" }
  }

  const frontmatter = content.slice(3, endIdx).trim()
  const lines = frontmatter.split("\n")

  let summary: string | null = null
  const readWhen: string[] = []
  let collectingReadWhen = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.startsWith("summary:")) {
      summary = line.slice("summary:".length).trim().replace(/^['"]|['"]$/g, "")
      collectingReadWhen = false
      continue
    }

    if (line.startsWith("read_when:")) {
      collectingReadWhen = true
      const inline = line.slice("read_when:".length).trim()
      if (inline.startsWith("[") && inline.endsWith("]")) {
        try {
          const parsed = JSON.parse(inline.replace(/'/g, '"'))
          if (Array.isArray(parsed)) {
            readWhen.push(...parsed.map(String).filter((s) => s.trim().length > 0))
          }
        } catch {
          // ignore inline parse failure
        }
      }
      continue
    }

    if (collectingReadWhen) {
      if (line.startsWith("- ")) {
        const hint = line.slice(2).trim().replace(/^['"]|['"]$/g, "")
        if (hint) readWhen.push(hint)
      } else if (line !== "") {
        collectingReadWhen = false
      }
    }
  }

  return { summary, readWhen }
}

function main() {
  if (!fs.existsSync(targetDocsDir)) {
    console.log(`[docs-list] Docs directory not found at: ${targetDocsDir}`)
    return
  }

  console.log(`📚 Indexing documentation in: ${targetDocsDir}\n`)
  const files = walkMarkdownFiles(targetDocsDir)
  if (files.length === 0) {
    console.log(`No markdown documentation files found in ${targetDocsDir}.`)
    return
  }

  const entries: DocEntry[] = files.map((rel) => {
    const full = path.join(targetDocsDir, rel)
    const meta = extractDocMetadata(full)
    return { file: rel, ...meta }
  })

  let indexedCount = 0
  for (const entry of entries) {
    if (entry.summary) {
      indexedCount++
      console.log(`📄 \x1b[1m${entry.file}\x1b[0m`)
      console.log(`   Summary: ${entry.summary}`)
      if (entry.readWhen.length > 0) {
        console.log(`   \x1b[36mRead when\x1b[0m: ${entry.readWhen.join("; ")}`)
      }
      console.log("")
    } else {
      console.log(`📄 ${entry.file} \x1b[90m(no summary frontmatter)\x1b[0m`)
    }
  }

  console.log(`\nFound ${files.length} doc file(s), ${indexedCount} with indexed triggers.`)
}

main()
