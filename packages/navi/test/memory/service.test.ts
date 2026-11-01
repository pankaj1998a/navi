import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Memory } from "@/memory"
import { writeWikiPage } from "@/memory/wiki"
import { beginHandoff } from "@/memory/handoff"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"

const it = testEffect(Memory.defaultLayer)

describe("memory service", () => {
  it.instance("exposes wiki, profile, and handoff operations through the service interface", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const test = yield* TestInstance

      // Wiki: empty store is healthy, written pages are listed and linted.
      expect(yield* memory.listWikiPages()).toEqual([])
      expect((yield* memory.lintWiki()).healthy).toBe(true)

      writeWikiPage({
        path: "gotchas/sample.md",
        title: "Sample Gotcha",
        content: "Always run tests from the package directory.",
      })
      const pages = yield* memory.listWikiPages()
      expect(pages.length).toBe(1)
      expect(pages[0]?.path).toBe("gotchas/sample.md")
      expect((yield* memory.lintWiki()).issues).toEqual([])

      // Profile: defaults are readable and updates are persisted.
      const initial = yield* memory.getUserProfile()
      expect(initial.package_manager).toBe("bun")
      const updated = yield* memory.updateUserProfile({ package_manager: "pnpm" })
      expect(updated.package_manager).toBe("pnpm")
      expect((yield* memory.getUserProfile()).package_manager).toBe("pnpm")

      // Handoffs: list/accept/cancel round-trip scoped to the temp directory.
      expect(yield* memory.listHandoffs({ target_directory: test.directory, status: "all" })).toEqual([])
      expect((yield* memory.acceptHandoff({ target_directory: test.directory })).status).toBe("none_pending")
      expect(yield* memory.cancelHandoff("ho_missing")).toBe(false)

      const cancellable = beginHandoff({
        summary: "handoff to cancel",
        target_directory: test.directory,
      })
      expect((yield* memory.listHandoffs({ target_directory: test.directory })).length).toBe(1)
      expect(yield* memory.cancelHandoff(cancellable.id)).toBe(true)
      expect((yield* memory.listHandoffs({ target_directory: test.directory, status: "cancelled" })).length).toBe(1)

      beginHandoff({ summary: "handoff to accept", target_directory: test.directory })
      const accepted = yield* memory.acceptHandoff({ target_directory: test.directory })
      expect(accepted.status).toBe("claimed")
      expect(accepted.handoff?.summary).toBe("handoff to accept")
      expect((yield* memory.listHandoffs({ target_directory: test.directory, status: "claimed" })).length).toBe(1)
    }),
  )
})
