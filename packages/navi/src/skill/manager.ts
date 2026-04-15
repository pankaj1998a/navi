import fs from "fs/promises"
import path from "path"
import { Skill, SkillParser } from "./parser"
import { Log } from "../util/log"

export class SkillManager {
    private static log = Log.create({ service: "skill-manager" })
    private skills: Map<string, Skill> = new Map()

    constructor(private skillsDir: string) { }

    async scan(): Promise<void> {
        try {
            const entries = await fs.readdir(this.skillsDir, { withFileTypes: true })
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const skillPath = path.join(this.skillsDir, entry.name, "SKILL.md")
                    try {
                        const content = await fs.readFile(skillPath, "utf-8")
                        const skill = SkillParser.parse(content, skillPath)
                        this.skills.set(skill.info.name, skill)
                        SkillManager.log.debug("loaded skill", { name: skill.info.name, path: skillPath })
                    } catch (e) {
                        // Skip if SKILL.md doesn't exist or is invalid
                        SkillManager.log.warn("failed to load skill", { name: entry.name, error: String(e) })
                    }
                }
            }
        } catch (e) {
            SkillManager.log.error("failed to scan skills directory", { path: this.skillsDir, error: String(e) })
        }
    }

    getSkill(name: string): Skill | undefined {
        return this.skills.get(name)
    }

    listSkills(): Skill[] {
        return Array.from(this.skills.values())
    }
}


