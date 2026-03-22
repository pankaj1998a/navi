import { expect, test } from "bun:test"
import { SessionCompactionMemory } from "../../src/session/compaction-memory"

test("compaction memory parses structured markdown sections", () => {
  const parsed = SessionCompactionMemory.parse(`
## Objective
- Improve compaction quality

## Completed
- Added summary storage

## In Progress
- Wiring resume flow

## Files
- src/session/compaction.ts
- src/session/prompt.ts

## Constraints
- Keep summaries short

## Decisions
- Replace stale session summaries on each compaction

## Next Steps
- Add tests
`)

  expect(parsed.objective).toEqual(["Improve compaction quality"])
  expect(parsed.completed).toEqual(["Added summary storage"])
  expect(parsed.inProgress).toEqual(["Wiring resume flow"])
  expect(parsed.files).toEqual(["src/session/compaction.ts", "src/session/prompt.ts"])
  expect(parsed.constraints).toEqual(["Keep summaries short"])
  expect(parsed.decisions).toEqual(["Replace stale session summaries on each compaction"])
  expect(parsed.nextSteps).toEqual(["Add tests"])
})

test("compaction memory renders concise prompt sections", () => {
  const rendered = SessionCompactionMemory.render({
    objective: ["Stabilize session resume"],
    completed: ["Stored latest compaction summary"],
    inProgress: [],
    files: ["src/session/compaction.ts"],
    constraints: [],
    decisions: ["Use exact markdown headings for parsing"],
    nextSteps: ["Validate resume summaries"],
  })

  expect(rendered).toContain("## Objective")
  expect(rendered).toContain("- Stabilize session resume")
  expect(rendered).toContain("## Files")
  expect(rendered).toContain("src/session/compaction.ts")
  expect(rendered).not.toContain("## In Progress")
})
