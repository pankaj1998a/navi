import { expect, test } from "bun:test"
import { renderSymbolIndex } from "../../src/agent/codebase-map"

test("renderSymbolIndex builds file and symbol lookup tables", () => {
  const rendered = renderSymbolIndex([
    {
      name: "loop",
      type: "function",
      line: 42,
      file: "src/session/prompt.ts",
    },
    {
      name: "prompt",
      type: "function",
      line: 12,
      file: "src/session/prompt.ts",
    },
    {
      name: "Agent",
      type: "class",
      line: 8,
      file: "src/agent/agent.ts",
    },
  ], "V:/pankaj/navi")

  expect(rendered).toContain("# Symbol Index")
  expect(rendered).toContain("Files indexed: 2")
  expect(rendered).toContain("Purpose:")
  expect(rendered).toContain("src/session/prompt.ts")
  expect(rendered).toContain("`loop` (function) -> `src/session/prompt.ts:42`")
  expect(rendered).toContain("`Agent` (class) -> `src/agent/agent.ts:8`")
})
