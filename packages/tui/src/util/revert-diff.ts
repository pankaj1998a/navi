import { parsePatch } from "diff"

export function getRevertDiffFiles(diffText: string) {
  if (!diffText) return []

  try {
    return parsePatch(diffText).map((patch) => {
      const filename = [patch.newFileName, patch.oldFileName].find((item) => item && item !== "/dev/null") ?? "unknown"
      let additions = 0
      let deletions = 0

      for (const hunk of patch.hunks) {
        for (const line of hunk.lines) {
          if (line.startsWith("+")) additions++
          else if (line.startsWith("-")) deletions++
        }
      }

      return {
        filename: filename.replace(/^[ab]\//, ""),
        additions,
        deletions,
      }
    })
  } catch {
    return []
  }
}
