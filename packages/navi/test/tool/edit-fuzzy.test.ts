import { describe, expect, test } from "bun:test"
import { replace } from "../../src/tool/edit"
import { fuzzyReplaceNative } from "../../src/native/native-runner"

describe("Phase 1: Native Rust Fuzzy Edit Engine", () => {
  test("native runner binary is discoverable and operational", () => {
    const res = fuzzyReplaceNative("const x = 1;\n", "const x = 1;", "const x = 2;", false)
    expect(res).not.toBeNull()
    expect(res?.success).toBe(true)
    expect(res?.result).toBe("const x = 2;\n")
  })

  describe("Strategy 1: Exact Replacements", () => {
    test("replaces exact single occurrence", () => {
      const content = "function add(a, b) {\n  return a + b;\n}\n"
      const res = replace(content, "return a + b;", "return a + b + 0;")
      expect(res).toBe("function add(a, b) {\n  return a + b + 0;\n}\n")
    })

    test("fails fast on ambiguous multiple occurrences without replaceAll", () => {
      const content = "const x = 1;\nconst x = 1;\n"
      expect(() => replace(content, "const x = 1;", "const x = 2;", false)).toThrow(
        "Found multiple matches for oldString",
      )
    })

    test("replaces all occurrences when replaceAll is true", () => {
      const content = "const x = 1;\nconst y = 2;\nconst x = 1;\n"
      const res = replace(content, "const x = 1;", "const x = 42;", true)
      expect(res).toBe("const x = 42;\nconst y = 2;\nconst x = 42;\n")
    })

    test("throws when oldString equals newString", () => {
      const content = "hello world"
      expect(() => replace(content, "world", "world")).toThrow(
        "No changes to apply: oldString and newString are identical.",
      )
    })
  })

  describe("Strategy 2 & 3: Whitespace & Indentation Drift", () => {
    test("matches when file has trailing whitespace but oldString does not", () => {
      const content = "function greet() {   \n    console.log('hi');   \n}\n"
      const search = "function greet() {\n    console.log('hi');\n}"
      const replacement = "function greet() {\n    console.log('hello world');\n}"
      const res = replace(content, search, replacement)
      expect(res).toBe("function greet() {\n    console.log('hello world');\n}\n")
    })

    test("matches when file has 4-space indentation and oldString has 2-space indentation", () => {
      const content = "class Worker {\n    execute() {\n        return true;\n    }\n}\n"
      const search = "execute() {\n  return true;\n}"
      const replacement = "execute() {\n    return false;\n}"
      const res = replace(content, search, replacement)
      expect(res).toBe("class Worker {\n    execute() {\n    return false;\n}\n}\n")
    })

    test("matches when file has tab indentation and oldString has space indentation", () => {
      const content = "function compute() {\n\tconst a = 10;\n\tconst b = 20;\n\treturn a + b;\n}\n"
      const search = "const a = 10;\nconst b = 20;\nreturn a + b;"
      const replacement = "\tconst sum = 30;\n\treturn sum;"
      const res = replace(content, search, replacement)
      expect(res).toBe("function compute() {\n\tconst sum = 30;\n\treturn sum;\n}\n")
    })
  })

  describe("Strategy 4: Unicode Normalization (Quotes, Dashes, Non-Breaking Spaces)", () => {
    test("matches smart curly double quotes in source with straight quotes in search", () => {
      const content = 'const title = “Advanced Agentic Coding”;\n'
      const search = 'const title = "Advanced Agentic Coding";'
      const replacement = 'const title = "Autonomous Agentic Coding";'
      const res = replace(content, search, replacement)
      expect(res).toBe('const title = "Autonomous Agentic Coding";\n')
    })

    test("matches smart curly single quotes in source with straight apostrophes in search", () => {
      const content = "const str = ‘hello world’;\n"
      const search = "const str = 'hello world';"
      const replacement = "const str = 'hello universe';"
      const res = replace(content, search, replacement)
      expect(res).toBe("const str = 'hello universe';\n")
    })

    test("matches em-dash and en-dash in source with standard hyphen in search", () => {
      const content = "const banner = 'Option A — First Priority – Level 1';\n"
      const search = "const banner = 'Option A - First Priority - Level 1';"
      const replacement = "const banner = 'Option B - Second Priority - Level 2';"
      const res = replace(content, search, replacement)
      expect(res).toBe("const banner = 'Option B - Second Priority - Level 2';\n")
    })

    test("matches non-breaking spaces (\u00A0) in source with regular spaces in search", () => {
      const content = "const\u00A0value\u00A0=\u00A042;\n"
      const search = "const value = 42;"
      const replacement = "const value = 100;"
      const res = replace(content, search, replacement)
      expect(res).toBe("const value = 100;\n")
    })
  })

  describe("Strategy 5: Context-Anchor Matching", () => {
    test("matches multi-line block when middle comments or lines drift slightly", () => {
      const content = [
        "export async function processPipeline() {",
        "  // Internal pipeline telemetry",
        "  const auth = await verifyAuth()",
        "  const session = await createSession(auth)",
        "  return session",
        "}",
      ].join("\n")

      const search = [
        "export async function processPipeline() {",
        "  const auth = await verifyAuth()",
        "  const session = await createSession(auth)",
        "  return session",
        "}",
      ].join("\n")

      const replacement = [
        "export async function processPipeline() {",
        "  const auth = await verifyAuth()",
        "  return createSessionDirect(auth)",
        "}",
      ].join("\n")

      const res = replace(content, search, replacement)
      expect(res).toContain("createSessionDirect(auth)")
      expect(res).not.toContain("Internal pipeline telemetry")
    })
  })

  describe("Stress & Scale Verification", () => {
    test("replaces accurately in large 5,000-line source file in milliseconds", () => {
      const lines: string[] = []
      for (let i = 0; i < 5000; i++) {
        lines.push(`const var_${i} = ${i * 10};`)
      }
      lines[2500] = "  function targetToReplace() { return 'needle'; }  "
      const content = lines.join("\n")

      const search = "function targetToReplace() {\n  return 'needle';\n}"
      const replacement = "function targetToReplace() {\n  return 'replaced_by_rust';\n}"

      const start = performance.now()
      const res = replace(content, search, replacement)
      const elapsed = performance.now() - start

      expect(res).toContain("replaced_by_rust")
      expect(elapsed).toBeLessThan(150) // Native sub-process execution completes in <150ms
    })
  })
})
