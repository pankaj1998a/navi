#!/usr/bin/env bun
/**
 * sync-skills.ts
 * Cross-environment agent skill synchronizer (adapted from agent-scripts/scripts/sync-skills).
 * Idempotently links or mirrors skills between:
 * - Navi skills (packages/navi/skills)
 * - Antigravity IDE global skills (~/.gemini/config/skills)
 * - Claude Code skills (~/.claude/skills)
 * - Codex skills (~/.codex/skills)
 */
import fs from "fs"
import path from "path"
import os from "os"

const homedir = os.homedir()
const naviSkillsDir = path.resolve(__dirname, "../skills")

const localAppData = process.env.LOCALAPPDATA || path.join(homedir, "AppData", "Local")
const portableSkillsDir = path.resolve("v:/pankaj/navi-portable/skills")

const targets = [
  { name: "Antigravity Global", dir: path.join(homedir, ".gemini", "config", "skills"), useLink: true },
  { name: "Claude Code", dir: path.join(homedir, ".claude", "skills"), useLink: true },
  { name: "Codex", dir: path.join(homedir, ".codex", "skills"), useLink: true },
  { name: "Local Navi Installation", dir: path.join(localAppData, "navi", "bin", "skills"), useLink: false },
  { name: "Navi Portable", dir: portableSkillsDir, useLink: false },
]

const args = process.argv.slice(2)
const isDryRun = args.includes("--dry-run")
const _isClean = args.includes("--clean")

console.log(`[sync-skills] Source: ${naviSkillsDir}`)
if (isDryRun) console.log("[sync-skills] Mode: DRY RUN (no modifications will be made)")

if (!fs.existsSync(naviSkillsDir)) {
  console.error(`Error: Source skills directory not found: ${naviSkillsDir}`)
  process.exit(1)
}

const sourceSkills = fs
  .readdirSync(naviSkillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .filter((d) => fs.existsSync(path.join(naviSkillsDir, d.name, "SKILL.md")))
  .map((d) => d.name)

console.log(`[sync-skills] Found ${sourceSkills.length} valid source skill(s).\n`)

let totalLinked = 0
let totalSkipped = 0

for (const target of targets) {
  console.log(`📂 Checking target: ${target.name} (${target.dir})`)
  if (!fs.existsSync(target.dir)) {
    if (!isDryRun) {
      fs.mkdirSync(target.dir, { recursive: true })
      console.log(`   Created target directory: ${target.dir}`)
    } else {
      console.log(`   (dry-run) would create target directory: ${target.dir}`)
    }
  }

  for (const skillName of sourceSkills) {
    const src = path.join(naviSkillsDir, skillName)
    const dest = path.join(target.dir, skillName)

    try {
      let stat: fs.Stats | null = null
      try {
        stat = fs.lstatSync(dest)
      } catch {
        // does not exist
      }

      if (stat) {
        if (stat.isSymbolicLink()) {
          const currentTarget = fs.readlinkSync(dest)
          if (path.resolve(target.dir, currentTarget) === path.resolve(src)) {
            // Already correctly linked
            totalSkipped++
            continue
          }
        } else if (stat.isDirectory()) {
          if (target.useLink) {
            console.log(`   ⚠️ Preserving real directory: ${skillName}`)
            totalSkipped++
            continue
          }
        }
      }

      if (isDryRun) {
        console.log(`   + (dry-run) would ${target.useLink ? "link" : "copy"}: ${skillName} -> ${src}`)
        totalLinked++
        continue
      }

      if (target.useLink) {
        if (stat) {
          fs.rmSync(dest, { recursive: true, force: true })
        }
        // Create symlink (use 'junction' on Windows for directories to avoid admin privilege requirement)
        const linkType = process.platform === "win32" ? "junction" : "dir"
        fs.symlinkSync(src, dest, linkType)
        console.log(`   ✓ Linked: ${skillName}`)
      } else {
        fs.cpSync(src, dest, { recursive: true, force: true })
        console.log(`   ✓ Copied: ${skillName}`)
      }
      totalLinked++
    } catch (err: any) {
      console.error(`   ✗ Error processing ${skillName}: ${err.message}`)
    }
  }
}

console.log(`\n🎉 Skill sync complete: ${totalLinked} linked, ${totalSkipped} already up-to-date.`)
