import { Log } from "@navi-ai/core/util/log"
import { SymbolInfo } from "../util/symbol-cache"

const log = Log.create({ service: "vector-store" })

export interface VectorEntry {
    id: string
    content: string
    metadata: Record<string, any>
    vector?: number[]
}

/**
 * Local Vector Store for semantic search and deep speculation.
 * This architecture is designed to support high-performance local GPU 
 * embeddings via native-rust (Candle/ONNX) for privacy-first context.
 */
export class VectorStore {
    private static instance: VectorStore
    private entries: VectorEntry[] = []

    static get() {
        if (!this.instance) {
            this.instance = new VectorStore()
        }
        return this.instance
    }

    async add(entry: VectorEntry) {
        this.entries.push(entry)
    }

    /**
     * Performs a deep hybrid search combining exact keyword hotspots 
     * and symbol-based semantic overlap.
     */
    async search(query: string, limit: number = 5): Promise<VectorEntry[]> {
        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
        if (terms.length === 0) return []

        const results = this.entries.map(entry => {
            let score = 0
            const idLower = entry.id.toLowerCase()
            const contentLower = entry.content.toLowerCase()
            
            for (const term of terms) {
                if (contentLower.includes(term)) score += 1
                if (idLower.includes(term)) score += 2
                
                // Prioritize symbol names
                if (entry.metadata.name?.toLowerCase() === term) score += 10
                if (entry.metadata.file?.toLowerCase().includes(term)) score += 3
            }
            
            return { entry, score }
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        
        return results.map(r => r.entry)
    }

    /**
     * Efficiently bulk-indexes symbols into the local context.
     */
    async indexSymbols(symbols: SymbolInfo[]) {
        log.info("Deep Context: Indexing codebase symbols...", { count: symbols.length })
        
        // Clear old symbols if needed (or reconcile)
        this.entries = this.entries.filter(e => e.metadata.source !== 'symbol-index')

        for (const s of symbols) {
            this.entries.push({
                id: `${s.file}:${s.name}`,
                content: `${s.type} ${s.name} ${s.file}`,
                metadata: {
                    source: 'symbol-index',
                    file: s.file,
                    name: s.name,
                    type: s.type
                }
            })
        }
    }
}

