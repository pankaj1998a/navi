export interface DiffResult {
    additions: number
    deletions: number
    modifications: number
    diffText: string
}

export interface LevenshteinResult {
    distance: number
    similarity: number
}

/**
 * Simple diff implementation
 */
export function createDiff(oldText: string, newText: string): DiffResult {
    const oldLines = oldText.split('\n')
    const newLines = newText.split('\n')

    let additions = 0
    let deletions = 0

    const diffLines: string[] = []
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];

        if (oldLine !== newLine) {
            if (oldLine !== undefined) {
                diffLines.push(`-${oldLine}`)
                deletions++
            }
            if (newLine !== undefined) {
                diffLines.push(`+${newLine}`)
                additions++
            }
        } else {
            diffLines.push(` ${oldLine}`)
        }
    }

    return {
        additions,
        deletions,
        modifications: 0,
        diffText: diffLines.join('\n')
    }
}

/**
 * Optimized Levenshtein distance
 */
export function levenshteinDistance(a: string, b: string): LevenshteinResult {
    const lenA = a.length
    const lenB = b.length
    const dp: number[][] = Array(lenA + 1).fill(null).map(() => Array(lenB + 1).fill(0))

    for (let i = 0; i <= lenA; i++) dp[i][0] = i
    for (let j = 0; j <= lenB; j++) dp[0][j] = j

    for (let i = 1; i <= lenA; i++) {
        for (let j = 1; j <= lenB; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
        }
    }

    const distance = dp[lenA][lenB]
    const maxLength = Math.max(lenA, lenB)
    return {
        distance,
        similarity: maxLength === 0 ? 1 : 1 - (distance / maxLength)
    }
}
