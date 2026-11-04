import { expect, test } from "bun:test"
import { searchTools } from "../../src/tool/tool-search"

test("discovers runtime tools by description rather than a fixed list", () => {
  const result = searchTools(
    [
      { id: "custom_registry", description: "Check dependency versions against package registries." },
      { id: "bash", description: "Execute shell commands." },
    ],
    "dependency versions",
    5,
  )
  expect(result.map((tool) => tool.id)).toEqual(["custom_registry"])
  expect(result[0]?.description).toContain("package registries")
})

test("ranks exact names first and never invents tools absent from the catalog", () => {
  expect(
    searchTools(
      [
        { id: "mcp_packages", description: "package_versions package_versions" },
        { id: "package_versions", description: "Check published dependencies." },
      ],
      "package_versions",
      1,
    ).map((tool) => tool.id),
  ).toEqual(["package_versions"])
  expect(searchTools([], "browser", 5)).toEqual([])
})

test("handles empty queries and bounds result limits", () => {
  const catalog = Array.from({ length: 30 }, (_, index) => ({
    id: `custom_${index}`,
    description: "Search packages.",
  }))
  expect(searchTools(catalog, "  ", 5)).toEqual([])
  expect(searchTools(catalog, "packages", 100)).toHaveLength(20)
  expect(searchTools(catalog, "packages", -1)).toHaveLength(1)
  expect(searchTools(catalog, "packages", Number.NaN)).toHaveLength(5)
})
