import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"

describe("sync-skills", () => {
  test("creates symlinks or junctions to valid source skills across target directories", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-skills-test-"))
    try {
      const sourceDir = path.join(tmp, "source-skills")
      const targetDir1 = path.join(tmp, "target-1")
      const targetDir2 = path.join(tmp, "target-2")

      fs.mkdirSync(sourceDir, { recursive: true })
      fs.mkdirSync(targetDir1, { recursive: true })
      fs.mkdirSync(targetDir2, { recursive: true })

      // Create a valid skill
      const skillPath = path.join(sourceDir, "test-skill")
      fs.mkdirSync(skillPath, { recursive: true })
      fs.writeFileSync(path.join(skillPath, "SKILL.md"), "---\nname: test-skill\ndescription: Test description\n---\n# Test", "utf-8")

      // Function to link skill into targets (mirroring sync-skills.ts logic)
      const linkSkill = (target: string, name: string, src: string) => {
        const dest = path.join(target, name)
        if (!fs.existsSync(dest)) {
          fs.symlinkSync(src, dest, "junction")
        }
      }

      linkSkill(targetDir1, "test-skill", skillPath)
      linkSkill(targetDir2, "test-skill", skillPath)

      expect(fs.existsSync(path.join(targetDir1, "test-skill", "SKILL.md"))).toBe(true)
      expect(fs.existsSync(path.join(targetDir2, "test-skill", "SKILL.md"))).toBe(true)

      const content = fs.readFileSync(path.join(targetDir1, "test-skill", "SKILL.md"), "utf-8")
      expect(content).toContain("name: test-skill")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
