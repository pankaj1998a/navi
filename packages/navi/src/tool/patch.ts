import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { Tool } from "./tool"
import { FileTime } from "../file/time"
import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"
import { Instance } from "../project/instance"
import { Patch } from "../patch"
import { createTwoFilesPatch } from "diff"
import { assertExternalDirectory } from "./external-directory"
import { LSP } from "../lsp"
import { Filesystem } from "../util/filesystem"

const PatchParams = z.object({
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
})

export const PatchTool = Tool.define("patch", {
  description:
    "Apply a patch to modify multiple files. Supports adding, updating, and deleting files with context-aware changes.",
  parameters: PatchParams,
  async execute(params, ctx) {
    if (!params.patchText) {
      throw new Error("patchText is required")
    }

    // Parse the patch to get hunks
    let hunks: Patch.Hunk[]
    try {
      const parseResult = Patch.parsePatch(params.patchText)
      hunks = parseResult.hunks
    } catch (error) {
      throw new Error(`Failed to parse patch: ${error}`)
    }

    if (hunks.length === 0) {
      throw new Error("No file changes found in patch")
    }

    // Validate file paths and check permissions
    const fileChanges: Array<{
      filePath: string
      oldContent: string
      newContent: string
      type: "add" | "update" | "delete" | "move"
      movePath?: string
      diff: string
    }> = []

    let totalDiff = ""

    for (const hunk of hunks) {
      const filePath = path.resolve(Instance.directory, hunk.path)
      await assertExternalDirectory(ctx, filePath)

      switch (hunk.type) {
        case "add":
          if (hunk.type === "add") {
            const oldContent = ""
            const newContent = hunk.contents
            const diff = createTwoFilesPatch(filePath, filePath, oldContent, newContent)

            fileChanges.push({
              filePath,
              oldContent,
              newContent,
              type: "add",
              diff,
            })

            totalDiff += diff + "\n"
          }
          break

        case "update":
          // Check if file exists for update
          const stats = await fs.stat(filePath).catch(() => null)
          if (!stats || stats.isDirectory()) {
            throw new Error(`File not found or is directory: ${filePath}`)
          }

          // Read file and update time tracking (like edit tool does)
          await FileTime.assert(ctx.sessionID, filePath)
          const oldContent = await fs.readFile(filePath, "utf-8")
          let newContent = oldContent

          // Apply the update chunks to get new content
          try {
            const fileUpdate = Patch.deriveNewContentsFromChunks(filePath, hunk.chunks)
            newContent = fileUpdate.content
          } catch (error) {
            throw new Error(`Failed to apply update to ${filePath}: ${error}`)
          }

          const diff = createTwoFilesPatch(filePath, filePath, oldContent, newContent)

          const movePath = hunk.move_path ? path.resolve(Instance.directory, hunk.move_path) : undefined
          await assertExternalDirectory(ctx, movePath)

          fileChanges.push({
            filePath,
            oldContent,
            newContent,
            type: hunk.move_path ? "move" : "update",
            movePath,
            diff,
          })

          totalDiff += diff + "\n"
          break

        case "delete":
          // Check if file exists for deletion
          await FileTime.assert(ctx.sessionID, filePath)
          const contentToDelete = await fs.readFile(filePath, "utf-8")
          const deleteDiff = createTwoFilesPatch(filePath, filePath, contentToDelete, "")

          fileChanges.push({
            filePath,
            oldContent: contentToDelete,
            newContent: "",
            type: "delete",
            diff: deleteDiff,
          })

          totalDiff += deleteDiff + "\n"
          break
      }
    }

    // Check permissions if needed
    const relativePaths = fileChanges.map((c) => path.relative(Instance.worktree, c.filePath))
    await ctx.ask({
      permission: "edit",
      patterns: relativePaths,
      always: ["*"],
      metadata: {
        diff: totalDiff,
        files: fileChanges.map((change) => ({
          filePath: change.filePath,
          relativePath: path.relative(Instance.worktree, change.filePath),
          type: change.type,
          diff: change.diff,
          movePath: change.movePath,
        })),
      },
    })

    // Apply the changes
    const changedFiles: string[] = []

    for (const change of fileChanges) {
      switch (change.type) {
        case "add":
          // Create parent directories
          const addDir = path.dirname(change.filePath)
          if (addDir !== "." && addDir !== "/") {
            await fs.mkdir(addDir, { recursive: true })
          }
          await fs.writeFile(change.filePath, change.newContent, "utf-8")
          changedFiles.push(change.filePath)
          break

        case "update":
          await fs.writeFile(change.filePath, change.newContent, "utf-8")
          changedFiles.push(change.filePath)
          break

        case "move":
          if (change.movePath) {
            // Create parent directories for destination
            const moveDir = path.dirname(change.movePath)
            if (moveDir !== "." && moveDir !== "/") {
              await fs.mkdir(moveDir, { recursive: true })
            }
            // Write to new location
            await fs.writeFile(change.movePath, change.newContent, "utf-8")
            // Remove original
            await fs.unlink(change.filePath)
            changedFiles.push(change.movePath)
          }
          break

        case "delete":
          await fs.unlink(change.filePath)
          changedFiles.push(change.filePath)
          break
      }

      // Update file time tracking
      const target = change.movePath ?? change.filePath
      FileTime.read(ctx.sessionID, target)
      if (change.type === "move" && change.filePath) {
        // also read the old path? No, it's gone.
      }
    }

    // Publish file change events
    for (const change of fileChanges) {
      const file = change.movePath ?? change.filePath
      const event = change.type === "add" ? "add" : change.type === "delete" ? "unlink" : "change"
      await Bus.publish(FileWatcher.Event.Updated, { file, event })
    }

    // Notify LSP of file changes
    for (const change of fileChanges) {
      if (change.type === "delete") continue
      const target = change.movePath ?? change.filePath
      await LSP.touchFile(target, true)
    }

    // Get Diagnostics
    const diagnostics = await LSP.diagnostics()

    // Report LSP errors
    let output = `Patch applied successfully.`
    const MAX_DIAGNOSTICS_PER_FILE = 20
    for (const change of fileChanges) {
      if (change.type === "delete") continue
      const target = change.movePath ?? change.filePath
      const normalized = Filesystem.normalizePath(target)
      const issues = diagnostics[normalized] ?? []
      const errors = issues.filter((item) => item.severity === 1)
      if (errors.length > 0) {
        const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
        const suffix =
          errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
        output += `\n\nLSP errors detected in ${path.relative(Instance.worktree, target)}, please fix:\n<diagnostics file="${target}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
      }
    }

    return {
      title: `${fileChanges.length} files changed`,
      metadata: {
        diff: totalDiff,
        files: fileChanges.map((change) => ({
          filePath: change.filePath,
          relativePath: path.relative(Instance.worktree, change.filePath),
          type: change.type,
          diff: change.diff,
          movePath: change.movePath,
        })),
        diagnostics,
      },
      output: output + `\n${relativePaths.map((p) => `  ${p}`).join("\n")}`,
    }
  },
})
