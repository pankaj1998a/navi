import { Log } from "../util/log"
import { IndexService } from "../codebase/index-service"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"

export interface SpeculationResult {
  symbolName: string
  impactedFiles: string[]
  semanticMatches: string[]
  preLoadedContent: Map<string, string>
}

/**
 * Speculative Execution Engine
 * Pre-calculates codebase context and dependency maps in the background.
 */
export class SpeculationEngine {
  private static log = Log.create({ service: "speculation" })
  private static cache = new Map<string, SpeculationResult>()
  private static MAX_CACHE_SIZE = 10

  static async initialize() {
    this.log.info("Initializing Speculation Engine...")
    
    // Subscribe to file changes to pre-warm context
    Bus.subscribe(FileWatcher.Event.Updated, (event) => {
      this.handleFileChange(event.properties.file)
    })
  }

  private static async handleFileChange(file: string) {
    this.log.debug("Reactive speculation triggered by file change", { file })
    // In a real scenario, we would parse the file to find changed symbols.
    // For now, we use the filename as a hint.
    const hint = file.split(/[/\\]/).pop()?.split(".")[0]
    if (hint) {
      await this.propose(hint)
    }
  }

  /**
   * Propose a speculative task based on a symbol or partial query.
   */
  static async propose(query: string) {
    this.log.debug("Proposing speculation", { query })
    
    const symbols = this.extractSymbols(query)
    
    for (const symbol of symbols) {
      if (this.cache.has(symbol)) continue
      
      this.log.info("Speculating on symbol", { symbol })
      
      try {
        const impactedFiles = await IndexService.getImpactedFiles(symbol)
        
        const preLoadedContent = new Map<string, string>()
        for (const file of impactedFiles.slice(0, 5)) {
          const content = await Bun.file(file).text().catch(() => null)
          if (content) preLoadedContent.set(file, content)
        }

        this.cache.set(symbol, {
          symbolName: symbol,
          impactedFiles,
          semanticMatches: [], 
          preLoadedContent
        })

        if (this.cache.size > this.MAX_CACHE_SIZE) {
          const firstKey = this.cache.keys().next().value
          if (firstKey) this.cache.delete(firstKey)
        }

      } catch (e) {
        this.log.error("Speculation failed", { symbol, error: String(e) })
      }
    }
  }

  /**
   * Get speculative results for an active query.
   */
  static getResults(query: string): SpeculationResult[] {
    const symbols = this.extractSymbols(query)
    return symbols
      .map(s => this.cache.get(s))
      .filter((r): r is SpeculationResult => !!r)
  }

  static clear() {
    this.cache.clear()
  }

  private static extractSymbols(query: string): string[] {
    // Simple heuristic: words that look like CamelCase or snake_case symbols
    const matches = query.match(/[A-Z][a-zA-Z0-9]+|[a-z]+_[a-z0-9_]+/g) ?? []
    return Array.from(new Set(matches))
  }
}

