import { describe, expect, test } from "bun:test"
import { isReadOnlyMcpTool, mcpPermissionName, mcpToolRequiresApproval, shouldGateMcpTool } from "../../src/mcp/index"

describe("MCP permission gating", () => {
  test("permission name is namespaced by server", () => {
    expect(mcpPermissionName("github")).toBe("mcp:github")
    expect(mcpPermissionName("my-server")).toBe("mcp:my-server")
  })

  test("read-only MCP tools skip approval", () => {
    expect(isReadOnlyMcpTool({ annotations: { readOnlyHint: true } })).toBe(true)
    expect(shouldGateMcpTool({ annotations: { readOnlyHint: true } })).toBe(false)
  })

  test("mutating and unannotated MCP tools require approval", () => {
    expect(isReadOnlyMcpTool({})).toBe(false)
    expect(shouldGateMcpTool({})).toBe(true)
    expect(shouldGateMcpTool({ annotations: { readOnlyHint: false } })).toBe(true)
  })

  test("a server-declared readOnlyHint alone cannot bypass approval", () => {
    const spoofed = { name: "write_file", annotations: { readOnlyHint: true } }
    expect(mcpToolRequiresApproval("evil", spoofed, [])).toBe(true)
    expect(
      mcpToolRequiresApproval("evil", spoofed, [{ permission: "mcp:evil", pattern: "*", action: "ask" }]),
    ).toBe(true)
    expect(
      mcpToolRequiresApproval("evil", spoofed, [{ permission: "mcp:evil", pattern: "write_file", action: "allow" }]),
    ).toBe(false)
    expect(
      mcpToolRequiresApproval("evil", { name: "delete_all" }, [{ permission: "mcp:evil", pattern: "*", action: "allow" }]),
    ).toBe(
      true,
    )
  })

  test("a hint cannot borrow an allow rule from another server", () => {
    const spoofed = { name: "write_file", annotations: { readOnlyHint: true } }
    expect(
      mcpToolRequiresApproval("evil", spoofed, [{ permission: "mcp:trusted", pattern: "*", action: "allow" }]),
    ).toBe(true)
  })

  test("deny rules still gate a hinted read-only tool", () => {
    const hinted = { name: "read_file", annotations: { readOnlyHint: true } }
    expect(
      mcpToolRequiresApproval("evil", hinted, [{ permission: "mcp:evil", pattern: "*", action: "deny" }]),
    ).toBe(true)
  })

  test("only an explicit allow for this server and tool skips the prompt", () => {
    const hinted = { name: "read_file", annotations: { readOnlyHint: true } }
    expect(
      mcpToolRequiresApproval("evil", hinted, [{ permission: "mcp:evil", pattern: "read_*", action: "allow" }]),
    ).toBe(false)
    expect(
      mcpToolRequiresApproval("evil", hinted, [{ permission: "mcp:evil", pattern: "other", action: "allow" }]),
    ).toBe(true)
  })
})
