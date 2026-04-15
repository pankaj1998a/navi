import z from "zod"

const SECTION_MAP = new Map<string, keyof CompactionSummary>([
  ["objective", "objective"],
  ["goal", "objective"],
  ["request", "objective"],
  ["completed", "completed"],
  ["done", "completed"],
  ["finished", "completed"],
  ["in progress", "inProgress"],
  ["active", "inProgress"],
  ["current", "inProgress"],
  ["open work", "inProgress"],
  ["files", "files"],
  ["files touched", "files"],
  ["constraints", "constraints"],
  ["preferences", "constraints"],
  ["decisions", "decisions"],
  ["technical decisions", "decisions"],
  ["next steps", "nextSteps"],
  ["next", "nextSteps"],
  ["pending", "nextSteps"],
])

export const CompactionSummary = z.object({
  objective: z.array(z.string()).default([]),
  completed: z.array(z.string()).default([]),
  inProgress: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
})

export type CompactionSummary = z.infer<typeof CompactionSummary>

export namespace SessionCompactionMemory {
  export function parse(text: string): CompactionSummary {
    const result: Record<keyof CompactionSummary, string[]> = {
      objective: [],
      completed: [],
      inProgress: [],
      files: [],
      constraints: [],
      decisions: [],
      nextSteps: [],
    }

    let current: keyof CompactionSummary | undefined
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) continue

      const heading = line.match(/^#{1,6}\s+(.+?)\s*:?$/)
      if (heading) {
        current = SECTION_MAP.get(normalizeHeading(heading[1]))
        continue
      }

      if (!current) continue
      const value = line.replace(/^[-*]\s+/, "").trim()
      if (!value) continue
      result[current].push(value)
    }

    return CompactionSummary.parse(result)
  }

  export function render(summary: CompactionSummary): string {
    const sections: string[] = []
    pushSection(sections, "Objective", summary.objective, 3)
    pushSection(sections, "Completed", summary.completed, 6)
    pushSection(sections, "In Progress", summary.inProgress, 4)
    pushSection(sections, "Files", summary.files, 8)
    pushSection(sections, "Constraints", summary.constraints, 4)
    pushSection(sections, "Decisions", summary.decisions, 4)
    pushSection(sections, "Next Steps", summary.nextSteps, 5)
    return sections.join("\n\n")
  }

  export function hasContent(summary: CompactionSummary): boolean {
    return Object.values(summary).some((items) => items.length > 0)
  }

  function pushSection(output: string[], title: string, items: string[], limit: number) {
    if (!items.length) return
    output.push([`## ${title}`, ...items.slice(0, limit).map((item) => `- ${item}`)].join("\n"))
  }

  function normalizeHeading(input: string) {
    return input.toLowerCase().replace(/\s+/g, " ").trim()
  }
}



