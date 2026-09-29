import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Parameters } from "../../src/tool/knowledge"

describe("tool/knowledge parameters", () => {
  test("accepts list with no id", () => {
    expect(Schema.decodeUnknownSync(Parameters)({ action: "list" }).action).toBe("list")
  })

  test("rejects unknown action", () => {
    expect(() => Schema.decodeUnknownSync(Parameters)({ action: "bogus" })).toThrow()
  })

  test("accepts save with title and content", () => {
    const parsed = Schema.decodeUnknownSync(Parameters)({ action: "save", title: "t", content: "c" })
    expect(parsed.title).toBe("t")
  })
})
