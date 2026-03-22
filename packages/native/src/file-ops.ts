import glob from 'fast-glob'
import fs from 'fs-extra'
import path from 'path'

export interface FileEntry {
  path: string
  content: string
  size: number
}

export class FileOps {
  /**
   * Find files matching glob patterns
   */
  async findFiles(
    cwd: string,
    patterns: string[],
    ignore: string[] = []
  ): Promise<string[]> {
    return glob(patterns, {
      cwd,
      ignore: [...ignore, '**/node_modules/**', '**/.git/**'],
      dot: true,
      onlyFiles: true,
      absolute: false,
    })
  }

  /**
   * Read multiple files
   */
  async readFiles(cwd: string, paths: string[]): Promise<FileEntry[]> {
    const results: FileEntry[] = []

    for (const p of paths) {
      const fullPath = path.resolve(cwd, p)
      try {
        if (await fs.pathExists(fullPath)) {
          const content = await fs.readFile(fullPath, 'utf-8')
          const stat = await fs.stat(fullPath)
          results.push({
            path: p,
            content,
            size: stat.size
          })
        }
      } catch (error) {
        console.error(`Failed to read file ${p}:`, error)
      }
    }

    return results
  }

  /**
   * Write file ensuring directory exists
   */
  async writeFile(cwd: string, filePath: string, content: string): Promise<void> {
    const fullPath = path.resolve(cwd, filePath)
    await fs.ensureDir(path.dirname(fullPath))
    await fs.writeFile(fullPath, content, 'utf-8')
  }

  /**
   * Delete file or directory
   */
  async deletePath(cwd: string, filePath: string): Promise<void> {
    const fullPath = path.resolve(cwd, filePath)
    await fs.remove(fullPath)
  }

  /**
   * Read file with line limit and offset (1-based start line)
   */
  async readFilePartial(filePath: string, startLine: number = 1, limit?: number): Promise<string> {
    // Ensure path is loaded efficiently. For large files we might want to use streams or read chunk by chunk.
    // For now, load and slice (TS implementation limitation compared to Rust)
    // To optimize, we could use read stream and count newlines.

    const content = await fs.readFile(filePath, 'utf-8')
    if (!limit && startLine === 1) return content

    const lines = content.split('\n')
    const start = Math.max(0, startLine - 1)
    const end = limit ? start + limit : lines.length

    return lines.slice(start, end).join('\n')
  }
}

export const fileOps = new FileOps()
export const readFileCore = async (path: string, startLine: number, limit: number) => fileOps.readFilePartial(path, startLine, limit)

export interface LsEntry {
  path: string
  isDir: boolean
  size: number
  mtime: number
}

export async function ls(dir: string, ignore: string[] = [], limit: number = 100): Promise<LsEntry[]> {
  const entries = await glob('**/*', {
    cwd: dir,
    ignore: [...ignore, '**/node_modules/**', '**/.git/**'],
    dot: true,
    stats: true,
    onlyFiles: false,
    absolute: true,
    // Limit depth if needed, but recursive is implied by usage
  })

  const result: LsEntry[] = []
  for (const entry of entries) {
    if (result.length >= limit) break
    result.push({
      path: entry.path,
      isDir: entry.stats?.isDirectory() ?? false,
      size: entry.stats?.size ?? 0,
      mtime: entry.stats?.mtimeMs ?? 0
    })
  }
  return result
}

