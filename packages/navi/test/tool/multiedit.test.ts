import { describe, expect, test } from "bun:test"
import path from "path"
import { MultiEditTool } from "../../src/tool/multiedit"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

const multiEditTool = await MultiEditTool.init()
const readTool = await ReadTool.init()

describe("tool.multiedit", () => {
  test("applies multi-file edits and top-level filePath fallback", async () => {
    await using fixture = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "alpha.txt"), "alpha one")
        await Bun.write(path.join(dir, "beta.txt"), "beta two")
        await Bun.write(path.join(dir, "shared.txt"), "hello world")
      },
    })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        await readTool.execute({ filePath: path.join(fixture.path, "alpha.txt") }, ctx)
        await readTool.execute({ filePath: path.join(fixture.path, "beta.txt") }, ctx)
        await readTool.execute({ filePath: path.join(fixture.path, "shared.txt") }, ctx)

        const multiFileResult = await multiEditTool.execute(
          {
            edits: [
              {
                filePath: path.join(fixture.path, "alpha.txt"),
                oldString: "alpha",
                newString: "ALPHA",
              },
              {
                filePath: path.join(fixture.path, "beta.txt"),
                oldString: "beta",
                newString: "BETA",
              },
            ],
          },
          ctx,
        )

        expect(multiFileResult.title).toContain("2 files changed")
        expect(multiFileResult.metadata.files).toHaveLength(2)
        expect(multiFileResult.metadata.files[0]).toContain("alpha.txt")
        expect(multiFileResult.metadata.files[1]).toContain("beta.txt")
        expect(multiFileResult.metadata.results).toHaveLength(2)
        expect(await Bun.file(path.join(fixture.path, "alpha.txt")).text()).toBe("ALPHA one")
        expect(await Bun.file(path.join(fixture.path, "beta.txt")).text()).toBe("BETA two")

        const fallbackResult = await multiEditTool.execute(
          {
            filePath: path.join(fixture.path, "shared.txt"),
            edits: [
              {
                oldString: "hello",
                newString: "hi",
              },
              {
                oldString: "world",
                newString: "there",
              },
            ],
          },
          ctx,
        )

        expect(fallbackResult.title).toContain("shared.txt")
        expect(fallbackResult.metadata.files).toHaveLength(1)
        expect(fallbackResult.metadata.files[0]).toContain("shared.txt")
        expect(await Bun.file(path.join(fixture.path, "shared.txt")).text()).toBe("hi there")
      },
    })
  })
})
