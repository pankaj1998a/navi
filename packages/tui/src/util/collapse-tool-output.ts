function exceedsMaxChars(text: string, maxChars: number): boolean {
  if (text.length <= maxChars) return false
  let count = 0
  for (const _ of text) {
    count++
    if (count > maxChars) return true
  }
  return false
}

export function collapseToolOutput(output: string, maxLines: number, maxChars: number) {
  let lineCount = 1
  let cutoff = -1
  let idx = 0

  while (idx < output.length) {
    const next = output.indexOf("\n", idx)
    if (next === -1) break
    lineCount++
    if (lineCount > maxLines) {
      cutoff = next
      break
    }
    idx = next + 1
  }

  const exceedsLines = lineCount > maxLines
  if (!exceedsLines && !exceedsMaxChars(output, maxChars)) {
    return { output, overflow: false }
  }

  const preview = cutoff === -1 ? output : output.slice(0, cutoff)
  if (exceedsMaxChars(preview, maxChars)) {
    return {
      output:
        Array.from(preview)
          .slice(0, Math.max(0, maxChars - 1))
          .join("") + "…",
      overflow: true,
    }
  }

  return { output: `${preview}\n…`, overflow: true }
}
