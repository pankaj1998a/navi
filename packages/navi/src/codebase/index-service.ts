import * as NativeImport from "../native"
const Native = NativeImport as any
import { Log } from "@navi-ai/core/util/log"
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
  private static initializingPromise: Promise<void> | null = null

  /**
   * Builds the entire project graph and vector index asynchronously.
   */
  static async initialize() {
    if (this.isInitialized) return
    if (this.initializingPromise) return this.initializingPromise

    const root = Instance.directory
    if (!root) {
      this.log.warn("Cannot initialize index: No project directory found.")
      return
    }

    this.initializingPromise = (async () => {
      this.log.info("Building Symbolic Knowledge Graph in background...", { root })
      try {
        const tags = await Native.scanCodebase(root)
        this.log.info(`Scanned ${tags.length} symbols.`)

        this.graph.clear()
        this.vectorStore.clear()

        for (const tag of tags) {
          this.graph.addNode(tag)
        }

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
      } finally {
        this.initializingPromise = null
      }
    })()

    return this.initializingPromise
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
   * Rescans a specific file and updates the graph incrementally.
   */
  static async updateFile(filePath: string) {
    if (!this.isInitialized) return
    this.log.debug("Updating index for file", { filePath })
    try {
      if (filePath.endsWith(".go")) {
        const goTags = await IndexService.fallbackScanGo(filePath)
        for (const tag of goTags) {
          IndexService.graph.addNode(tag)
        }
      } else {
        const tags = await Native.scanCodebase(filePath)
        for (const tag of tags) {
          IndexService.graph.addNode(tag)
        }
      }
    } catch (e) {
      this.log.error("Failed to update index for file", { filePath, error: String(e) })
    }
  }

  /**
   * Simple regex fallback for Go symbol extraction.
   */
  private static async fallbackScanGo(filePath: string): Promise<any[]> {
    try {
      const content = await Bun.file(filePath).text()
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

