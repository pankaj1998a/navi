import { Log } from "../util/log"
import { readFileSync } from "fs"

export interface DocumentEntry {
    path: string
    content: string
    score?: number
}

export class SemanticSearch {
    private static log = Log.create({ service: "semantic-search" })
    private static index: DocumentEntry[] = []

    static async buildIndex(files: string[]): Promise<void> {
        this.log.info("building semantic index", { fileCount: files.length })
        this.index = files.map(path => ({
            path,
            content: readFileSync(path, "utf8")
        }))
    }

    // Feature 1: Keyword/Semantic Hybrid Search
    static search(query: string, limit = 5): DocumentEntry[] {
        const queryTerms = query.toLowerCase().split(/\s+/)

        const results = this.index.map(doc => {
            let score = 0
            const content = doc.content.toLowerCase()

            queryTerms.forEach(term => {
                if (content.includes(term)) score += 1
                // Boost scores for filename matches
                if (doc.path.toLowerCase().includes(term)) score += 5
            })

            return { ...doc, score }
        })

        return results
            .filter(r => (r.score ?? 0) > 0)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, limit)
    }

    // Feature 2: Smart Context Pruning
    static pruneContext(docs: DocumentEntry[], taskDescription: string): DocumentEntry[] {
        const taskTerms = taskDescription.toLowerCase().split(/\s+/)

        return docs.map(doc => {
            const lines = doc.content.split("\n")
            const relevantLines = lines.filter(line =>
                taskTerms.some(term => line.toLowerCase().includes(term))
            )

            // If we pruned too much, keep at least some context
            if (relevantLines.length < 5) {
                return doc
            }

            return {
                ...doc,
                content: `// [Context Pruned]\n${relevantLines.join("\n")}`
            }
        })
    }
}
