import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { applyPatch, parsePatch, diffLines } from "diff"
import { File } from "../file"
import { Bus } from "../bus"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectory } from "./external-directory"

const MAX_DIAGNOSTICS_PER_FILE = 20

export const UnifiedDiffTool = Tool.define("unified_diff", {
  description: "Apply a standard unified diff patch to a file. This is more resilient to whitespace and context changes than exact string replacement.",
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    diff: z.string().describe("The unified diff to apply (standard diff -u format)"),
  }),
  async execute(params, ctx) {
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    const filePath = (path.isAbsolute(params.filePath!) ? params.filePath! : path.join(Instance.directory, params.filePath!))
    await assertExternalDirectory(ctx, filePath)

    let contentOld = ""
    let contentNew = ""
    let diffOutput = params.diff

    await FileTime.withLock(filePath, async () => {
      const file = Bun.file(filePath)
      const stats = await file.stat().catch(() => { })
      
      if (!stats) throw new Error(`File ${filePath} not found`)
      if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)
      
      await FileTime.assert(ctx.sessionID, filePath)
      contentOld = await file.text()

      // Take a snapshot before applying
      await Snapshot.track()

      // Apply the patch
      const result = applyPatch(contentOld, params.diff!, {
        fuzzFactor: 2, // Allow some context mismatch
      })

      if (result === false) {
        throw new Error(`Failed to apply unified diff to ${filePath}. Ensure the context lines match the current file content.`)
      }

      contentNew = result

      // Calculate stats for metadata
      let additions = 0
      let deletions = 0
      for (const change of diffLines(contentOld, contentNew)) {
        if (change.added) additions += change.count || 0
        if (change.removed) deletions += change.count || 0
      }

      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filePath)],
        always: ["*"],
        metadata: {
          filepath: filePath,
          diff: params.diff!,
          summary: `+${additions} lines, -${deletions} lines (Unified Diff)`
        },
      })

      await Bun.write(filePath, contentNew)
      await Bus.publish(File.Event.Edited, {
        file: filePath,
      })
      FileTime.read(ctx.sessionID, filePath)
    })

    const filediff: Snapshot.FileDiff = {
      file: filePath,
      before: contentOld,
      after: contentNew,
      additions: 0,
      deletions: 0,
    }
    for (const change of diffLines(contentOld, contentNew)) {
      if (change.added) filediff.additions += change.count || 0
      if (change.removed) filediff.deletions += change.count || 0
    }

    ctx.metadata({
      metadata: {
        diff: diffOutput!,
        filediff,
        diagnostics: {},
      },
    })

    let output = "Unified diff applied successfully."
    await LSP.touchFile(filePath, false)
    const diagnostics = await LSP.diagnostics()
    const normalizedFilePath = Filesystem.normalizePath(filePath)
    const issues = diagnostics[normalizedFilePath] ?? []
    const errors = issues.filter((item) => item.severity === 1)
    if (errors.length > 0) {
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      output += `\n\nLSP errors detected in this file:\n<diagnostics file="${filePath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }

    return {
      metadata: {
        diagnostics,
        diff: diffOutput!,
        filediff,
      },
      title: `${path.relative(Instance.worktree, filePath)}`,
      output,
    }
  },
})


