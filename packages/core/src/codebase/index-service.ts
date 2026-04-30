import { Native } from "../util/native"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import path from "path"

/**
 * High-performance indexing service for the Symbolic Knowledge Graph and Vector Store.
 * Coordinates between the native Rust core and the Navi application layer.
 */
export class IndexService {
  private static log = Log.create({ service: "index.service" })
  private static graph = new Native.SymbolGraph()
  private static vectorStore = new Native.VectorStore()
  private static isInitialized = false

  /**
   * Builds the entire project graph and vector index.
   */
  static async initialize() {
    if (this.isInitialized) return
    
    const root = Instance.directory
    if (!root) {
      this.log.warn("Cannot initialize index: No project directory found.")
      return
    }

    this.log.info("Building Symbolic Knowledge Graph...", { root })
    
    try {
      // 1. Scan codebase using native Rust multi-threading
      const tags = await Native.scanCodebase(root)
      this.log.info(`Scanned ${tags.length} symbols.`)

      // 2. Populate the graph and vector store
      this.graph.clear()
      this.vectorStore.clear()

      for (const tag of tags) {
        this.graph.addNode(tag)
      }

      // 3. Go support fallback (if Rust scanner didn't pick up .go files)
      const goFiles = await IndexService.findFiles(root, [".go"])
      if (goFiles.length > 0) {
        IndexService.log.info(`Scanning ${goFiles.length} Go files via fallback...`)
        for (const file of goFiles) {
          const goTags = await IndexService.fallbackScanGo(file)
          for (const tag of goTags) {
            IndexService.graph.addNode(tag)
          }
        }
      }

      this.isInitialized = true
      this.log.info("Knowledge Graph initialized successfully.")
    } catch (e) {
      this.log.error("Failed to initialize Knowledge Graph", { error: String(e) })
    }
  }

  static getGraph() {
    return this.graph
  }

  static getVectorStore() {
    return this.vectorStore
  }

  /**
   * Returns a list of files impacted by a given symbol.
   */
  static async getImpactedFiles(symbolName: string): Promise<string[]> {
    if (!this.isInitialized) await this.initialize()
    return this.graph.getImpactedFiles(symbolName)
  }

  /**
   * Rescans a specific file and updates the graph.
   */
  static async updateFile(filePath: string) {
    if (!this.isInitialized) return
    this.log.debug("Updating index for file", { filePath })
    // Implementation for incremental updates...
  }

  /**
   * Simple regex fallback for Go symbol extraction.
   */
  private static async fallbackScanGo(filePath: string): Promise<any[]> {
    try {
      // Use dynamic import for bun to avoid issues in non-bun environments if any
      const { file } = await import("bun")
      const content = await file(filePath).text()
      const lines = content.split('\n')
      const tags: any[] = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Match func, type struct, type interface
        const funcMatch = line.match(/func\s+([A-Z][a-zA-Z0-9_]+)\s*\(/)
        const methodMatch = line.match(/func\s*\(\s*[^)]+\s*\)\s+([A-Z][a-zA-Z0-9_]+)\s*\(/)
        const typeMatch = line.match(/type\s+([A-Z][a-zA-Z0-9_]+)\s+(struct|interface)/)

        if (funcMatch || methodMatch || typeMatch) {
          const name = (funcMatch || methodMatch || typeMatch)![1]
          const type = typeMatch ? typeMatch[2] : (methodMatch ? "method" : "function")
          tags.push({
            id: `go:${type}:${name}:${i+1}`,
            name,
            type,
            line: i + 1,
            path: filePath,
            dependencies: []
          })
        }
      }
      return tags
    } catch (e) {
      return []
    }
  }

  private static async findFiles(dir: string, exts: string[]): Promise<string[]> {
    const { Glob } = await import("bun")
    const glob = new Glob(`**/*{${exts.join(',')}}`)
    const files: string[] = []
    for await (const file of glob.scan(dir)) {
      if (file.includes("node_modules") || file.includes(".git") || file.includes("vendor")) continue
      files.push(path.resolve(dir, file))
    }
    return files
  }
}
