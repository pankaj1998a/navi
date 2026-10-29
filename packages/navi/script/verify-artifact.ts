import { readdir, stat } from "node:fs/promises"
import path from "node:path"

const forbiddenExtensions = [".map"]

export async function verifyArtifact(target: string) {
  const files = await artifactFiles(target)
  if (files.length === 0) throw new Error(`Artifact contains no published files: ${target}`)
  for (const file of files) {
    if (forbiddenExtensions.some((ext) => file.endsWith(ext))) {
      throw new Error(`Artifact file ${file} should not be published`)
    }
  }
}

async function artifactFiles(target: string): Promise<string[]> {
  if ((await stat(target)).isFile()) return [target]
  return (await collectFiles(target)).map((file) => path.join(target, file))
}

async function collectFiles(root: string, current = root): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(current, { withFileTypes: true })).map(async (entry) => {
        const target = path.join(current, entry.name)
        return entry.isDirectory() ? collectFiles(root, target) : [path.relative(root, target)]
      }),
    )
  ).flat()
}

if (import.meta.main) {
  const target = process.argv[2]
  if (!target) throw new Error("Usage: bun run script/verify-artifact.ts <file-or-directory>")
  await verifyArtifact(target)
}
