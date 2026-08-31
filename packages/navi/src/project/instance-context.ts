import { LocalContext } from "@/util/local-context"
import { AppFileSystem } from "@navi-ai/core/filesystem"
import os from "os"
import type * as Project from "./project"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}

export const context = LocalContext.create<InstanceContext>("instance")

/**
 * Check if a path is within the project boundary.
 * Returns true if path is inside ctx.directory OR ctx.worktree.
 * Paths within the worktree but outside the working directory should not trigger external_directory permission.
 */
export function containsPath(filepath: string, ctx: InstanceContext): boolean {
  if (AppFileSystem.contains(ctx.directory, filepath)) return true
  // Non-git or global projects (e.g. "/" or drive root or home directory when .git is in $HOME)
  // would match ANY absolute path if worktree was checked.
  // Skip worktree check in this case to preserve external_directory permissions.
  if (ctx.project?.id === "global") return false
  const normWorktree = AppFileSystem.normalizePath(ctx.worktree)
  const normHome = AppFileSystem.normalizePath(os.homedir())
  if (normWorktree === normHome) return false
  const isRoot = /^[a-zA-Z]:[\\/]?$|^[\\/]$/.test(ctx.worktree)
  if (isRoot) return false
  return AppFileSystem.contains(ctx.worktree, filepath)
}
