import matter from "gray-matter"
import z from "zod"

export const SkillSchema = z.object({
    name: z.string(),
    description: z.string(),
    tools: z.array(z.string()).optional(),
    scripts: z.array(z.string()).optional(),
    references: z.array(z.string()).optional(),
})

export type SkillInfo = z.infer<typeof SkillSchema>

export interface Skill {
    info: SkillInfo
    instructions: string
    path: string
}

export class SkillParser {
    static parse(content: string, filePath: string): Skill {
        const { data, content: instructions } = matter(content)
        const info = SkillSchema.parse(data)

        return {
            info,
            instructions: instructions.trim(),
            path: filePath,
        }
    }
}


