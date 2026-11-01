import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import {
  collectDiff,
  diffArgs,
  errorText,
  finalText,
  finalValue,
  parseSchema,
  resolveDiffTarget,
  resolveTarget,
  stripAnsi,
  validateSchema,
  writeFinalMessage,
} from "./automation"

async function gitOut(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "navi-test",
      GIT_AUTHOR_EMAIL: "navi-test@example.com",
      GIT_COMMITTER_NAME: "navi-test",
      GIT_COMMITTER_EMAIL: "navi-test@example.com",
    },
  })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`)
  return stdout.trim()
}

async function git(cwd: string, args: string[]): Promise<void> {
  await gitOut(cwd, args)
}

async function readOrUndefined(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8")
  } catch {
    return undefined
  }
}

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
  await git(dir, ["init", "-q"])
  await writeFile(path.join(dir, "file.txt"), "one\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-qm", "initial"])
  return dir
}

describe("resolveDiffTarget", () => {
  test("defaults to uncommitted when no ref is supplied", () => {
    expect(resolveDiffTarget({})).toEqual({ ok: true, target: { type: "uncommitted" } })
    expect(resolveDiffTarget({ uncommitted: true })).toEqual({ ok: true, target: { type: "uncommitted" } })
  })

  test("uses --base and --commit when present", () => {
    expect(resolveDiffTarget({ base: "origin/dev" })).toEqual({
      ok: true,
      target: { type: "base", ref: "origin/dev" },
    })
    expect(resolveDiffTarget({ commit: "abc123" })).toEqual({
      ok: true,
      target: { type: "commit", sha: "abc123" },
    })
  })

  test("rejects ambiguous combinations", () => {
    expect(resolveDiffTarget({ base: "main", commit: "abc123" })).toEqual({
      ok: false,
      error: "--base and --commit cannot be used together",
    })
    expect(resolveDiffTarget({ uncommitted: true, base: "main" })).toEqual({
      ok: false,
      error: "--uncommitted cannot be combined with --base or --commit",
    })
  })
})

describe("diffArgs", () => {
  test("diffs uncommitted changes against HEAD so staged files are included", () => {
    expect(diffArgs({ type: "uncommitted" })).toEqual(["git", "diff", "--no-color", "HEAD"])
  })

  test("uses a three-dot diff for base refs", () => {
    expect(diffArgs({ type: "base", ref: "origin/dev" })).toEqual([
      "git",
      "diff",
      "--no-color",
      "origin/dev...HEAD",
    ])
  })

  test("uses git show for commits", () => {
    expect(diffArgs({ type: "commit", sha: "abc123" })).toEqual(["git", "show", "--no-color", "abc123"])
  })
})

describe("resolveTarget", () => {
  test("passes uncommitted targets through without running git", async () => {
    const target = { type: "uncommitted" } as const
    const result = await resolveTarget({
      target,
      run: async () => {
        throw new Error("git should not run")
      },
    })
    expect(result).toEqual({ ok: true, target })
  })

  test("resolves HEAD and abbreviated revisions to the full commit id", async () => {
    const dir = await tempRepo()
    try {
      const head = await gitOut(dir, ["rev-parse", "HEAD"])
      expect(head).toMatch(/^[0-9a-f]{40}$/)

      expect(await resolveTarget({ target: { type: "commit", sha: "HEAD" }, cwd: dir })).toEqual({
        ok: true,
        target: { type: "commit", sha: head },
      })
      expect(await resolveTarget({ target: { type: "commit", sha: head.slice(0, 7) }, cwd: dir })).toEqual({
        ok: true,
        target: { type: "commit", sha: head },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("feeds the resolved sha to diffArgs and git show", async () => {
    const dir = await tempRepo()
    try {
      const resolved = await resolveTarget({ target: { type: "commit", sha: "HEAD" }, cwd: dir })
      expect(resolved.ok).toBe(true)
      if (!resolved.ok) return
      const head = await gitOut(dir, ["rev-parse", "HEAD"])
      expect(diffArgs(resolved.target)).toEqual(["git", "show", "--no-color", head])
      expect(await collectDiff({ target: resolved.target, cwd: dir })).toContain("+one")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("resolves --base refs to their commit id", async () => {
    const dir = await tempRepo()
    try {
      const head = await gitOut(dir, ["rev-parse", "HEAD"])
      const resolved = await resolveTarget({ target: { type: "base", ref: "HEAD" }, cwd: dir })
      expect(resolved).toEqual({ ok: true, target: { type: "base", ref: head } })
      if (!resolved.ok) return

      await writeFile(path.join(dir, "second.txt"), "two\n")
      await git(dir, ["add", "."])
      await git(dir, ["commit", "-qm", "second"])
      expect(await collectDiff({ target: resolved.target, cwd: dir })).toContain("+two")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reports invalid refs with a clear error", async () => {
    const dir = await tempRepo()
    try {
      const commit = await resolveTarget({ target: { type: "commit", sha: "deadbeef" }, cwd: dir })
      expect(commit.ok).toBe(false)
      if (!commit.ok) {
        expect(commit.error).toContain("--commit")
        expect(commit.error).toContain("deadbeef")
      }

      const base = await resolveTarget({ target: { type: "base", ref: "no-such-branch" }, cwd: dir })
      expect(base.ok).toBe(false)
      if (!base.ok) {
        expect(base.error).toContain("--base")
        expect(base.error).toContain("no-such-branch")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("resolves --commit tag names (lightweight and annotated) to the peeled commit", async () => {
    const dir = await tempRepo()
    try {
      const head = await gitOut(dir, ["rev-parse", "HEAD"])
      await writeFile(path.join(dir, "file.txt"), "two\n")
      await git(dir, ["commit", "-qam", "second"])
      const second = await gitOut(dir, ["rev-parse", "HEAD"])
      await git(dir, ["tag", "light"])
      await git(dir, ["tag", "-a", "annotated", "-m", "release"])

      expect(await resolveTarget({ target: { type: "commit", sha: "light" }, cwd: dir })).toEqual({
        ok: true,
        target: { type: "commit", sha: second },
      })
      expect(await resolveTarget({ target: { type: "commit", sha: "annotated" }, cwd: dir })).toEqual({
        ok: true,
        target: { type: "commit", sha: second },
      })
      // An annotated tag object is not a commit; `^{commit}` must peel it.
      expect(await gitOut(dir, ["rev-parse", "annotated"])).not.toBe(second)
      expect(head).not.toBe(second)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("resolves --base branch names and keeps the three-dot diff semantics", async () => {
    const dir = await tempRepo()
    try {
      const first = await gitOut(dir, ["rev-parse", "HEAD"])
      await git(dir, ["branch", "feature"])
      await writeFile(path.join(dir, "second.txt"), "two\n")
      await git(dir, ["add", "."])
      await git(dir, ["commit", "-qm", "second"])

      const resolved = await resolveTarget({ target: { type: "base", ref: "feature" }, cwd: dir })
      expect(resolved).toEqual({ ok: true, target: { type: "base", ref: first } })
      if (!resolved.ok) return

      expect(diffArgs(resolved.target)).toEqual(["git", "diff", "--no-color", `${first}...HEAD`])
      expect(await collectDiff({ target: resolved.target, cwd: dir })).toContain("+two")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("rejects successful git output that is not a commit id", async () => {
    const result = await resolveTarget({
      target: { type: "commit", sha: "HEAD" },
      run: async () => ({ code: 0, stdout: "not-a-sha\n", stderr: "" }),
    })
    expect(result).toEqual({ ok: false, error: "--commit: unknown revision: HEAD" })
  })
})

describe("collectDiff", () => {
  test("forwards argv and cwd to the injected runner", async () => {
    const calls: { args: string[]; cwd: string }[] = []
    const text = await collectDiff({
      target: { type: "base", ref: "origin/main" },
      cwd: "/tmp/repo",
      run: async (args, cwd) => {
        calls.push({ args, cwd })
        return { code: 0, stdout: "diff --git a/x b/x\n", stderr: "" }
      },
    })
    expect(calls).toEqual([
      { args: ["git", "diff", "--no-color", "origin/main...HEAD"], cwd: "/tmp/repo" },
    ])
    expect(text).toBe("diff --git a/x b/x\n")
  })

  test("surfaces git failures with stderr", async () => {
    await expect(
      collectDiff({
        target: { type: "commit", sha: "deadbeef" },
        run: async () => ({ code: 128, stdout: "", stderr: "fatal: bad revision 'deadbeef'" }),
      }),
    ).rejects.toThrow("fatal: bad revision 'deadbeef'")
  })

  test("reads a real uncommitted diff from a temp repository", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      await git(dir, ["init", "-q"])
      await writeFile(path.join(dir, "file.txt"), "one\n")
      await git(dir, ["add", "."])
      await git(dir, ["commit", "-qm", "initial"])
      await writeFile(path.join(dir, "file.txt"), "one\ntwo\n")

      const diff = await collectDiff({ target: { type: "uncommitted" }, cwd: dir })
      expect(diff).toContain("+two")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("includes staged-only changes and ignores untracked files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      await git(dir, ["init", "-q"])
      await writeFile(path.join(dir, "file.txt"), "one\n")
      await git(dir, ["add", "."])
      await git(dir, ["commit", "-qm", "initial"])

      await writeFile(path.join(dir, "file.txt"), "one\ntwo\n")
      await git(dir, ["add", "file.txt"])
      const staged = await collectDiff({ target: { type: "uncommitted" }, cwd: dir })
      expect(staged).toContain("+two")

      await writeFile(path.join(dir, "untracked.txt"), "new\n")
      const withUntracked = await collectDiff({ target: { type: "uncommitted" }, cwd: dir })
      expect(withUntracked).toContain("+two")
      expect(withUntracked).not.toContain("untracked.txt")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns an empty diff for a clean working tree", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      await git(dir, ["init", "-q"])
      await writeFile(path.join(dir, "file.txt"), "one\n")
      await git(dir, ["add", "."])
      await git(dir, ["commit", "-qm", "initial"])

      expect(await collectDiff({ target: { type: "uncommitted" }, cwd: dir })).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("falls back to the index diff when HEAD has no commits yet", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      await git(dir, ["init", "-q"])
      await writeFile(path.join(dir, "file.txt"), "first\n")
      await git(dir, ["add", "file.txt"])

      const diff = await collectDiff({ target: { type: "uncommitted" }, cwd: dir })
      expect(diff).toContain("+first")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reports the fallback error when HEAD and the index diff both fail", async () => {
    const calls: string[][] = []
    await expect(
      collectDiff({
        target: { type: "uncommitted" },
        run: async (args) => {
          calls.push(args)
          return { code: 128, stdout: "", stderr: "fatal: not a git repository" }
        },
      }),
    ).rejects.toThrow("fatal: not a git repository")
    expect(calls).toEqual([
      ["git", "diff", "--no-color", "HEAD"],
      ["git", "diff", "--no-color", "--cached"],
    ])
  })
})

const contract = {
  type: "object",
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "message"],
        properties: {
          severity: { enum: ["P0", "P1", "P2", "P3"] },
          message: { type: "string" },
          line: { type: "integer" },
        },
      },
    },
  },
}

describe("validateSchema", () => {
  test("accepts a conforming value", () => {
    expect(
      validateSchema(contract, {
        summary: "looks good",
        findings: [{ severity: "P2", message: "missing test", line: 12 }],
      }),
    ).toEqual([])
  })

  test("reports missing required properties with their path", () => {
    expect(validateSchema(contract, { summary: "ok" })).toEqual([
      { path: "$.findings", message: "required property is missing" },
    ])
  })

  test("reports type mismatches and stops descending", () => {
    expect(validateSchema(contract, { summary: 3, findings: [] })).toEqual([
      { path: "$.summary", message: "expected string, got integer" },
    ])
  })

  test("validates array items and nested enum values", () => {
    const errors = validateSchema(contract, {
      summary: "ok",
      findings: [
        { severity: "P5", message: "bad severity" },
        { severity: "P1", message: "bad line", line: 1.5 },
        "not an object",
      ],
    })
    expect(errors).toEqual([
      { path: "$.findings[0].severity", message: 'expected one of "P0", "P1", "P2", "P3"' },
      { path: "$.findings[1].line", message: "expected integer, got number" },
      { path: "$.findings[2]", message: "expected object, got string" },
    ])
  })

  test("supports union types and null", () => {
    expect(validateSchema({ type: ["string", "null"] }, null)).toEqual([])
    expect(validateSchema({ type: ["string", "null"] }, 1)).toEqual([
      { path: "$", message: "expected string | null, got integer" },
    ])
    expect(validateSchema({ type: ["string", "integer"] }, 3)).toEqual([])
    expect(validateSchema({ type: ["string", "integer"] }, true)).toEqual([
      { path: "$", message: "expected string | integer, got boolean" },
    ])
  })

  test("validates nested arrays of arrays and objects with precise paths", () => {
    const schema = {
      type: "object",
      properties: {
        matrix: {
          type: "array",
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "tags"],
              properties: {
                id: { type: "integer" },
                tags: { type: "array", items: { enum: ["a", "b"] } },
              },
            },
          },
        },
      },
    }
    expect(
      validateSchema(schema, {
        matrix: [[{ id: 1, tags: ["a"] }], [{ id: 2, tags: ["c"] }, { tags: [] }]],
      }),
    ).toEqual([
      { path: "$.matrix[1][0].tags[0]", message: 'expected one of "a", "b"' },
      { path: "$.matrix[1][1].id", message: "required property is missing" },
    ])
  })

  test("reports every missing required property", () => {
    expect(validateSchema({ type: "object", required: ["a", "b", "c"] }, { a: 1 })).toEqual([
      { path: "$.b", message: "required property is missing" },
      { path: "$.c", message: "required property is missing" },
    ])
  })

  test("compares enum entries structurally and reports root mismatches", () => {
    expect(validateSchema({ enum: [{ kind: "ok" }] }, { kind: "bad" })).toEqual([
      { path: "$", message: 'expected one of {"kind":"ok"}' },
    ])
    expect(validateSchema({ enum: [{ a: 1, b: [2, 3] }] }, { b: [2, 3], a: 1 })).toEqual([])
  })

  test("ignores non-object schemas", () => {
    expect(validateSchema(null, "anything")).toEqual([])
    expect(validateSchema([], "anything")).toEqual([])
  })

  test("ignores schemas and keywords it does not understand", () => {
    expect(validateSchema(true, "anything")).toEqual([])
    expect(validateSchema({ type: "object", additionalProperties: false }, { extra: 1 })).toEqual([])
  })
})

describe("parseSchema", () => {
  test("parses a JSON object schema", () => {
    expect(parseSchema('{"type":"object"}')).toEqual({ ok: true, schema: { type: "object" } })
  })

  test("rejects invalid JSON", () => {
    const parsed = parseSchema("{")
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain("invalid JSON")
  })

  test("rejects non-object schemas", () => {
    expect(parseSchema("[]")).toEqual({ ok: false, error: "schema must be a JSON object" })
    expect(parseSchema("42")).toEqual({ ok: false, error: "schema must be a JSON object" })
    expect(parseSchema("null")).toEqual({ ok: false, error: "schema must be a JSON object" })
  })
})

describe("finalText and finalValue", () => {
  test("joins finished text parts and skips unfinished, ignored, or synthetic ones", () => {
    expect(
      finalText({
        parts: [
          { type: "text", text: "first", time: { end: 1 } },
          { type: "text", text: "still streaming" },
          { type: "text", text: "ignored", time: { end: 2 }, ignored: true },
          { type: "text", text: "synthetic", time: { end: 3 }, synthetic: true },
          { type: "reasoning", text: "thinking", time: { end: 4 } },
          { type: "text", text: "second", time: { end: 5 } },
        ],
      }),
    ).toBe("first\n\nsecond")
  })

  test("prefers the structured value over text", () => {
    const message = {
      info: { structured: { summary: "ok", findings: [] } },
      parts: [{ type: "text", text: "ignored", time: { end: 1 } }],
    }
    expect(finalText(message)).toBe('{\n  "summary": "ok",\n  "findings": []\n}')
    expect(finalValue(message)).toEqual({ ok: true, value: { summary: "ok", findings: [] } })
  })

  test("parses unstructured text as JSON and reports parse failures", () => {
    expect(finalValue({ parts: [{ type: "text", text: '{"a":1}', time: { end: 1 } }] })).toEqual({
      ok: true,
      value: { a: 1 },
    })
    const bad = finalValue({ parts: [{ type: "text", text: "not json", time: { end: 1 } }] })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain("not valid JSON")
  })
})

describe("writeFinalMessage", () => {
  const text = (value: string) => ({ parts: [{ type: "text", text: value, time: { end: 1 } }] })
  const structured = (value: unknown) => ({ info: { structured: value }, parts: [] })

  test("writes the final text after a successful run without a schema", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      const file = path.join(dir, "last.txt")
      expect(await writeFinalMessage({ message: text("done"), output: "last.txt", cwd: dir })).toEqual({
        ok: true,
        text: "done",
        file,
      })
      expect(await readFile(file, "utf8")).toBe("done")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("writes validated structured output", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      const value = { summary: "ok", findings: [] }
      const result = await writeFinalMessage({ message: structured(value), schema: contract, output: "out.json", cwd: dir })
      expect(result.ok).toBe(true)
      expect(JSON.parse(await readFile(path.join(dir, "out.json"), "utf8"))).toEqual(value)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validates before writing and preserves an existing file on schema failure", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      const file = path.join(dir, "out.json")
      await writeFile(file, "previous output")

      const result = await writeFinalMessage({
        message: structured({ summary: "ok" }),
        schema: contract,
        output: "out.json",
        cwd: dir,
      })

      expect(result).toEqual({ ok: false, errors: ["$.findings: required property is missing"] })
      expect(await readFile(file, "utf8")).toBe("previous output")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("does not create the output file when validation fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      const result = await writeFinalMessage({
        message: structured({ summary: "ok", findings: [{ severity: "P9", message: "bad" }] }),
        schema: contract,
        output: "out.json",
        cwd: dir,
      })
      expect(result.ok).toBe(false)
      expect(await readOrUndefined(path.join(dir, "out.json"))).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("rejects non-JSON output when a schema is supplied without writing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      const result = await writeFinalMessage({ message: text("not json"), schema: contract, output: "out.json", cwd: dir })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors[0]).toContain("not valid JSON")
      expect(await readOrUndefined(path.join(dir, "out.json"))).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("refuses empty output instead of blanking the destination file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      const file = path.join(dir, "last.txt")
      await writeFile(file, "previous output")
      const result = await writeFinalMessage({ message: text("   "), output: "last.txt", cwd: dir })
      expect(result).toEqual({ ok: false, errors: ["The assistant produced no output to write"] })
      expect(await readFile(file, "utf8")).toBe("previous output")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("does not create the output file for empty output when none exists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      const result = await writeFinalMessage({ message: text("   "), output: "last.txt", cwd: dir })
      expect(result).toEqual({ ok: false, errors: ["The assistant produced no output to write"] })
      expect(await readOrUndefined(path.join(dir, "last.txt"))).toBeUndefined()
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("repeated schema failures leave an existing destination untouched", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      const file = path.join(dir, "out.json")
      await writeFile(file, "previous output")
      const input = {
        message: structured({ summary: "ok" }),
        schema: contract,
        output: "out.json",
        cwd: dir,
      }

      const first = await writeFinalMessage(input)
      const second = await writeFinalMessage(input)

      expect(first).toEqual({ ok: false, errors: ["$.findings: required property is missing"] })
      expect(second).toEqual(first)
      expect(await readFile(file, "utf8")).toBe("previous output")
      expect(await readdir(dir)).toEqual(["out.json"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a successful contract replaces an existing destination with exactly one write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      const file = path.join(dir, "out.json")
      await writeFile(file, "stale output that must not survive")
      const value = { summary: "ok", findings: [] }

      const result = await writeFinalMessage({ message: structured(value), schema: contract, output: "out.json", cwd: dir })

      expect(result.ok).toBe(true)
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(value)
      // No temp/partial siblings left behind by the write.
      expect(await readdir(dir)).toEqual(["out.json"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validates required-only schemas without a declared type", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "navi-automation-"))
    try {
      const result = await writeFinalMessage({
        message: structured({ summary: "ok" }),
        schema: { required: ["summary"] },
        output: "out.json",
        cwd: dir,
      })
      expect(result.ok).toBe(true)
      expect(JSON.parse(await readFile(path.join(dir, "out.json"), "utf8"))).toEqual({ summary: "ok" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("stripAnsi", () => {
  test("removes CSI color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m plain")).toBe("red plain")
  })

  test("removes OSC sequences", () => {
    expect(stripAnsi("\x1b]8;;https://example.com\x07link\x1b]8;;\x07")).toBe("link")
  })
})

describe("errorText", () => {
  test("prefers the named error message from SDK result bodies", () => {
    expect(errorText({ name: "BadRequest", data: { message: "schema rejected" } })).toBe("schema rejected")
  })

  test("falls back to Error messages and string values", () => {
    expect(errorText(new Error("boom"))).toBe("boom")
    expect(errorText("plain")).toBe("plain")
  })
})
