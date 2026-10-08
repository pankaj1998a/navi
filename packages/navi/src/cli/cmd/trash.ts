import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import fs from "fs"
import os from "os"
import path from "path"

function getTrashDir(): string {
  const home = os.homedir()
  if (process.platform === "darwin" || process.platform === "win32") {
    return path.join(home, ".Trash")
  }
  return path.join(home, ".local", "share", "Trash", "files")
}

function uniqueDestPathSync(trashDir: string, originalName: string): string {
  const base = path.basename(originalName)
  const ext = path.extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base

  let candidate = path.join(trashDir, base)
  if (!fs.existsSync(candidate)) {
    return candidate
  }

  const nonce = Date.now()
  for (let attempt = 1; attempt < 10_000; attempt += 1) {
    candidate = path.join(trashDir, `${stem}-${nonce}-${attempt}${ext}`)
    if (!fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(`Unable to find free Trash destination for ${base}`)
}

function moveSync(sourcePath: string, destinationPath: string): void {
  try {
    fs.renameSync(sourcePath, destinationPath)
  } catch {
    const stats = fs.lstatSync(sourcePath)
    fs.cpSync(sourcePath, destinationPath, { recursive: stats.isDirectory(), errorOnExist: true })
    fs.rmSync(sourcePath, { recursive: stats.isDirectory(), force: true })
  }
}

export const TrashCommand = effectCmd({
  command: "trash <paths..>",
  describe: "Safely move files or directories to system Trash instead of permanent rm -rf",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("paths", {
        describe: "One or more file or directory paths to move to Trash",
        type: "string",
        array: true,
      })
      .option("allow-missing", {
        describe: "Do not error if a target path does not exist",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.trash")(function* (args) {
    const targets = (args.paths || []) as string[]
    if (targets.length === 0) {
      return yield* fail("No files or directories specified to move to Trash.")
    }

    const trashDir = getTrashDir()
    if (!fs.existsSync(trashDir)) {
      fs.mkdirSync(trashDir, { recursive: true })
    }

    const moved: string[] = []
    const missing: string[] = []
    const errors: string[] = []

    for (const raw of targets) {
      const trimmed = String(raw).trim()
      if (!trimmed) continue

      const absPath = path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed)
      if (!fs.existsSync(absPath)) {
        if (!args["allow-missing"]) {
          missing.push(trimmed)
        }
        continue
      }

      try {
        const dest = uniqueDestPathSync(trashDir, absPath)
        moveSync(absPath, dest)
        moved.push(trimmed)
      } catch (err: any) {
        errors.push(`${trimmed}: ${err?.message || err}`)
      }
    }

    if (moved.length > 0) {
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ Moved ${moved.length} item(s) to Trash (${trashDir}):` + UI.Style.TEXT_NORMAL)
      for (const m of moved) {
        UI.println(`  • ${m}`)
      }
    }

    if (missing.length > 0) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + `⚠ Missing (${missing.length}):` + UI.Style.TEXT_NORMAL)
      for (const m of missing) {
        UI.println(`  • ${m}`)
      }
    }

    if (errors.length > 0) {
      UI.println(UI.Style.TEXT_DANGER_BOLD + `❌ Errors (${errors.length}):` + UI.Style.TEXT_NORMAL)
      for (const e of errors) {
        UI.println(`  • ${e}`)
      }
      return yield* fail(`Failed to move ${errors.length} item(s) to Trash.`)
    }
  }),
})
