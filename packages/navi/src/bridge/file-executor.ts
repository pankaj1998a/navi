import * as fs from "fs"
import * as path from "path"
import { spawnSync } from "child_process"
import * as Log from "@navi-ai/core/util/log"
import { applyPatchNative } from "@/native/native-runner"

const log = Log.create({ service: "bridge.file-executor" })

export interface ExtractedPatch {
  type: "navi_patch" | "unified_diff" | "code_block"
  rawText: string
  files: string[]
}

/**
 * Scans an LLM response from a Web AI (Claude, DeepSeek, ChatGPT)
 * to extract actionable file edits, patches, or code blocks.
 */
export function extractPatchesFromResponse(text: string): ExtractedPatch[] {
  const patches: ExtractedPatch[] = []

  // 1. Check for Navi/Goose patch format: *** Begin Patch ... *** End Patch
  const naviPatchRegex = /\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch/g
  let match: RegExpExecArray | null
  while ((match = naviPatchRegex.exec(text)) !== null) {
    const raw = match[0]
    const files: string[] = []
    const fileLineRegex = /\*\*\* (?:Add File|Update File|Delete File):\s*([^\r\n]+)/g
    let fMatch: RegExpExecArray | null
    while ((fMatch = fileLineRegex.exec(raw)) !== null) {
      if (fMatch[1]) {
        files.push(fMatch[1].trim())
      }
    }
    patches.push({
      type: "navi_patch",
      rawText: raw,
      files,
    })
  }

  // 2. Check for Unified Diff format: diff --git or --- a/ ... +++ b/
  const diffRegex = /(?:^|\n)(diff --git [^\n]+[\s\S]*?(?=\n(?:diff --git|$)))|(?:^|\n)(--- [^\n]+\n\+\+\+ [^\n]+[\s\S]*?(?=\n(?:--- |diff --git|$)))/g
  while ((match = diffRegex.exec(text)) !== null) {
    const raw = (match[1] || match[2] || "").trim()
    if (raw.includes("@@")) {
      const files: string[] = []
      const fileMatch = /\+\+\+ [b\/]?([^\s\t\n]+)/.exec(raw)
      if (fileMatch && fileMatch[1]) {
        files.push(fileMatch[1].replace(/^[ab]\//, "").trim())
      }
      patches.push({
        type: "unified_diff",
        rawText: raw,
        files,
      })
    }
  }

  // 3. Check for fenced code blocks with explicit filepath annotations
  // e.g. ```typescript filepath="src/utils.ts" or File: src/utils.ts\n```ts
  const fencedRegex = /(?:[Ff]ile:\s*`?([^\r\n`]+)`?\s*\n)?```[a-zA-Z0-9_-]*(?:\s+filepath=["']?([^\s"']+)["']?)?\r?\n([\s\S]*?)```/g
  while ((match = fencedRegex.exec(text)) !== null) {
    const filePath = (match[2] || match[1] || "").trim()
    const content = match[3] ?? ""
    if (filePath && !filePath.includes(" ") && (filePath.includes("/") || filePath.includes("\\") || filePath.includes("."))) {
      patches.push({
        type: "code_block",
        rawText: content,
        files: [filePath],
      })
    }
  }

  return patches
}

export interface ApplyResult {
  success: boolean
  appliedFiles: string[]
  error?: string
}

/**
 * Deterministically applies extracted patches or code blocks directly to workspace files.
 */
export function applyExtractedPatches(
  workspaceRoot: string,
  patches: ExtractedPatch[],
): ApplyResult {
  const applied: string[] = []

  for (const patch of patches) {
    if (patch.type === "navi_patch") {
      const res = applyPatchNative(workspaceRoot, patch.rawText)
      if (res && res.success) {
        applied.push(...res.modified_files, ...res.added_files)
      } else {
        const err = res?.error || "Failed to apply navi patch"
        log.warn("applyPatchNative failed", { error: err })
        return { success: false, appliedFiles: applied, error: err }
      }
    } else if (patch.type === "code_block" && patch.files.length === 1 && patch.files[0]) {
      const targetRel = patch.files[0]
      const fullPath = path.resolve(workspaceRoot, targetRel)
      try {
        const parent = path.dirname(fullPath)
        if (!fs.existsSync(parent)) {
          fs.mkdirSync(parent, { recursive: true })
        }
        fs.writeFileSync(fullPath, patch.rawText, "utf8")
        applied.push(targetRel)
      } catch (err: any) {
        return { success: false, appliedFiles: applied, error: err.message || String(err) }
      }
    } else if (patch.type === "unified_diff") {
      try {
        const gitRes = spawnSync("git", ["apply", "--whitespace=fix", "-"], {
          cwd: workspaceRoot,
          input: patch.rawText,
          encoding: "utf8",
        })
        if (gitRes.status === 0) {
          applied.push(...patch.files)
        } else {
          const stderrStr = String(gitRes.stderr || "").trim()
          log.warn("git apply returned non-zero", { stderr: stderrStr })
          return { success: false, appliedFiles: applied, error: stderrStr || "git apply failed" }
        }
      } catch (err: any) {
        return { success: false, appliedFiles: applied, error: String(err) }
      }
    }
  }

  return { success: true, appliedFiles: Array.from(new Set(applied)) }
}
