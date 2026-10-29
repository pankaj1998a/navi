import { describe, expect, test } from "bun:test"
import { mcpToolMetadata, mcpToolName, namespace } from "./index"
import { evaluate } from "@/permission/evaluate"
import { GlobTool } from "../tool/glob"
import { ShellTool } from "../tool/shell"

// Native navi tool ids an MCP server could plausibly expose a tool under.
const NATIVE_TOOL_IDS = [GlobTool.id, ShellTool.id]

// The name a tool carried before namespacing was introduced. Permission rules
// written against it must keep working.
const legacyName = (server: string, tool: string) =>
  server.replace(/[^a-zA-Z0-9_-]/g, "_") + "_" + tool.replace(/[^a-zA-Z0-9_-]/g, "_")

describe("mcp tool namespacing", () => {
  test("namespace replaces characters that are not valid in a tool name", () => {
    expect(namespace("my server")).toBe("my_server")
    expect(namespace("a.b/c")).toBe("a_b_c")
  })

  test("namespace leaves a valid server name untouched", () => {
    expect(namespace("my-server")).toBe("my-server")
    expect(namespace("srv_1")).toBe("srv_1")
  })

  test("mcpToolName prefixes the tool with the server namespace", () => {
    expect(mcpToolName("srv", "do_thing")).toBe("srv_do_thing")
  })

  test("two servers exposing the same tool name produce distinct names", () => {
    expect(mcpToolName("alpha", "do_thing")).not.toBe(mcpToolName("beta", "do_thing"))
    expect(mcpToolName("alpha", "do_thing")).toBe("alpha_do_thing")
    expect(mcpToolName("beta", "do_thing")).toBe("beta_do_thing")
  })

  test("an mcp tool named identically to a native navi tool does not collide", () => {
    for (const id of NATIVE_TOOL_IDS) {
      const mcpName = mcpToolName("srv", id)
      expect(mcpName).not.toBe(id)
      expect(NATIVE_TOOL_IDS).not.toContain(mcpName)
    }
  })

  test("an mcp tool named identically to a native navi tool keeps its own permission action", () => {
    for (const id of NATIVE_TOOL_IDS) {
      const metadata = mcpToolMetadata("srv", id)
      expect(metadata.permission).not.toBe(id)
      expect(metadata.permission).toBe(mcpToolName("srv", id))
    }
  })

  test("the namespaced name is the same name the tool carried before namespacing", () => {
    // Namespacing must not rename a tool, or every permission rule a user wrote
    // against the old name would stop matching.
    for (const server of ["srv", "my server", "my-server", "a.b/c", "Srv_1"]) {
      for (const tool of ["do_thing", "do thing", "read", "list-files"]) {
        expect(mcpToolName(server, tool)).toBe(legacyName(server, tool))
      }
    }
  })

  test("a server name that sanitizes to nothing still gets a namespace", () => {
    expect(namespace("")).toBe("mcp")
    expect(namespace("")).not.toBe("")
    expect(mcpToolName("", "read")).toBe("mcp_read")
    expect(mcpToolName("", "read")).not.toBe(mcpToolName("_", "read"))
  })

  test("a namespace that starts with a digit is still a valid tool name", () => {
    const name = mcpToolName("3d", "render")
    expect(name).toBe("3d_render")
    // Every provider accepts [A-Za-z0-9_-] for a tool name, a leading digit included.
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe("mcp tool permission evaluation", () => {
  const ruleset = (rules: Record<string, "allow" | "deny" | "ask">) =>
    Object.entries(rules).map(([permission, action]) => ({ permission, pattern: "*", action }))

  test("the permission action is the name the permission system matches a rule on", () => {
    const metadata = mcpToolMetadata("srv", "do_thing")
    const rule = evaluate(metadata.permission, "*", ruleset({ "*": "allow" }))
    expect(rule.action).toBe("allow")
  })

  test("a rule written as srv_* matches a namespaced mcp tool", () => {
    const metadata = mcpToolMetadata("srv", "do_thing")
    const rule = evaluate(metadata.permission, "*", ruleset({ "srv_*": "deny" }))
    expect(rule.action).toBe("deny")
  })

  test("a rule written as srv_do_* matches one tool of that server", () => {
    const metadata = mcpToolMetadata("srv", "do_thing")
    expect(evaluate(metadata.permission, "*", ruleset({ "srv_do_*": "deny" })).action).toBe("deny")
    expect(evaluate(mcpToolMetadata("srv", "other").permission, "*", ruleset({ "srv_do_*": "deny" })).action).toBe(
      "ask",
    )
  })

  test("a rule written for a native tool does not match a namespaced mcp tool", () => {
    // The mcp tool keeps its own namespace, so a rule for the native tool does
    // not reach it. This is the behaviour namespacing had before it was made
    // explicit, so it does not change any existing rule.
    const metadata = mcpToolMetadata("srv", "edit")
    expect(evaluate(metadata.permission, "*", ruleset({ edit: "deny" })).action).toBe("ask")
  })

  test("a namespaced mcp tool is denied by a rule that denies every tool", () => {
    const metadata = mcpToolMetadata("srv", "edit")
    expect(evaluate(metadata.permission, "*", ruleset({ "*": "deny" })).action).toBe("deny")
  })
})

describe("mcp tool metadata", () => {
  test("the permission action resolved for a namespaced mcp tool is the namespaced name", () => {
    const metadata = mcpToolMetadata("srv", "do_thing")
    expect(metadata.name).toBe("srv_do_thing")
    expect(metadata.permission).toBe("srv_do_thing")
    expect(metadata.permission).toBe(metadata.name)
  })

  test("metadata carries the owning server and the tool it came from", () => {
    const metadata = mcpToolMetadata("my server", "do_thing")
    expect(metadata.server).toBe("my server")
    expect(metadata.tool).toBe("do_thing")
    expect(metadata.name).toBe("my_server_do_thing")
    expect(metadata.permission).toBe("my_server_do_thing")
  })
})
