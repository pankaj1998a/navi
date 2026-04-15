/**
 * JSONRepair — A fuzzy JSON parser inspired by the ForgeCode crate.
 * Handles common LLM errors like:
 * - Trailing commas in arrays/objects
 * - Missing quotes on keys
 * - Missing closing brackets/braces (truncation)
 * - Single quotes instead of double quotes
 * - Markdown code blocks wrapping the JSON
 */
export namespace JSONRepair {
  /**
   * Attempts to repair a malformed JSON string.
   */
  export function repair(json: string): string {
    let repaired = json.trim()

    // 1. Remove Markdown code blocks if present
    const mdMatch = repaired.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    if (mdMatch) {
        repaired = mdMatch[1]!.trim()
    }

    // 2. Handle truncated JSON (missing closing brackets/braces)
    repaired = fixTruncated(repaired)

    // 3. Fix trailing commas (e.g., [1, 2,] -> [1, 2])
    repaired = repaired.replace(/,(\s*[\]}])/g, '$1')

    // 4. Fix unquoted keys (e.g., {key: "value"} -> {"key": "value"})
    repaired = repaired.replace(/([{,]\s*)([a-zA-Z0-9._-]+)(\s*:)/g, '$1"$2"$3')

    // 5. Fix single-quoted strings (e.g., 'key': 'value' -> "key": "value")
    repaired = repaired.replace(/'([^']*)'/g, '"$1"')

    return repaired
  }

  function fixTruncated(json: string): string {
    const stack: ('{' | '[')[] = []
    let inString = false
    let escaped = false

    for (let i = 0; i < json.length; i++) {
      const char = json[i]

      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '"') {
        inString = !inString
        continue
      }

      if (inString) continue

      if (char === '{') stack.push('{')
      if (char === '[') stack.push('[')
      if (char === '}') stack.pop()
      if (char === ']') stack.pop()
    }

    let fixed = json
    while (stack.length > 0) {
      const last = stack.pop()
      fixed += last === '{' ? '}' : ']'
    }

    return fixed
  }

  /**
   * Safe parse that attempts repair before failing.
   */
  export function tryParse<T>(input: string): T {
    try {
      return JSON.parse(input)
    } catch {
      const repaired = repair(input)
      try {
        return JSON.parse(repaired)
      } catch (err) {
        throw new Error(`Failed to parse JSON even after repair attempts: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
}
