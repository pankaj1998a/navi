#!/usr/bin/env bun
/**
 * validate-skills.ts
 *
 * Validates skill definitions (SKILL.md) in the Navi skills catalog.
 * Inspired by steipete/agent-scripts/scripts/validate-skills.
 *
 * Checks:
 * - Proper YAML frontmatter enclosed in ---
 * - Required string fields: name, description
 * - Unique skill names across the repository
 * - Absence of known dangerous shell patterns in examples
 */
import fs from "fs"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../")
const skillsDir = path.join(repoRoot, "skills")

interface SkillFrontmatter {
  name?: string
  description?: string
  [key: string]: unknown
}

function parseFrontmatter(content: string): { data: SkillFrontmatter | null; error: string | null } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) {
    return { data: null, error: "Frontmatter must start on line 1 and be enclosed in ---" }
  }

  const yamlBlock = match[1]
  const data: SkillFrontmatter = {}

  for (const line of yamlBlock.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const colonIndex = trimmed.indexOf(":")
    if (colonIndex === -1) continue

    const key = trimmed.slice(0, colonIndex).trim()
    let value = trimmed.slice(colonIndex + 1).trim()

    // Strip quotes if wrapped
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    data[key] = value
  }

  return { data, error: null }
}

function findSkillFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const results: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillPath = path.join(dir, entry.name, "SKILL.md")
      if (fs.existsSync(skillPath)) {
        results.push(skillPath)
      }
    }
  }

  return results
}

function main() {
  const skillFiles = findSkillFiles(skillsDir)
  if (skillFiles.length === 0) {
    console.warn(`[validate-skills] No skills found in ${skillsDir}`)
    process.exit(0)
  }

  console.log(`[validate-skills] Scanning ${skillFiles.length} skill(s) in ${skillsDir}...\n`)

  const errors: Array<{ file: string; message: string }> = []
  const seenNames = new Map<string, string>()

  for (const file of skillFiles) {
    const relPath = path.relative(repoRoot, file)
    const content = fs.readFileSync(file, "utf8")

    const { data, error } = parseFrontmatter(content)
    if (error || !data) {
      errors.push({ file: relPath, message: error ?? "Invalid frontmatter" })
      continue
    }

    if (!data.name || typeof data.name !== "string" || data.name.trim().length === 0) {
      errors.push({ file: relPath, message: "Missing or empty 'name' in frontmatter" })
    } else {
      const name = data.name.trim()
      if (seenNames.has(name)) {
        errors.push({ file: relPath, message: `Duplicate skill name '${name}' (already defined in ${seenNames.get(name)})` })
      } else {
        seenNames.set(name, relPath)
      }
    }

    if (!data.description || typeof data.description !== "string" || data.description.trim().length === 0) {
      errors.push({ file: relPath, message: "Missing or empty 'description' in frontmatter" })
    }

    // Safety check: ensure gh secret set does not misread stdin via --body -
    if (/gh\s+secret\s+set[\s\S]*?--body\s+-/.test(content)) {
      errors.push({ file: relPath, message: "`gh secret set` must read stdin by omitting `--body`; do not use `--body -`" })
    }
  }

  if (errors.length > 0) {
    console.error(`❌ Validation failed with ${errors.length} error(s):`)
    for (const err of errors) {
      console.error(`  - ${err.file}: ${err.message}`)
    }
    process.exit(1)
  }

  console.log(`✅ Successfully validated ${skillFiles.length} skill(s):`)
  for (const [name, file] of seenNames.entries()) {
    console.log(`  • ${name.padEnd(25)} -> ${file}`)
  }
}

main()
