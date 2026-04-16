import { createRequire } from 'module'
const require = createRequire(import.meta.url)

export interface NativeTag {
  id: string
  name: string
  type: string
  line: number
  path: string
  dependencies: string[]
}

export interface SearchResult {
  tag: NativeTag
  score: number
}

/**
 * Native bridge to the Rust-backed high-performance module.
 */
export namespace Native {
  let binding: any = null

  export function getBinding() {
    if (binding) return binding
    try {
      binding = require('../native/index')
      return binding
    } catch (e) {
      console.warn('Native binding not found, falling back to slow implementation.', e)
      return null
    }
  }

  /**
   * SymbolGraph for relational codebase analysis.
   */
  export class SymbolGraph {
    private instance: any

    constructor() {
      const bnd = getBinding()
      if (bnd?.SymbolGraph) {
        this.instance = new bnd.SymbolGraph()
      }
    }

    addNode(tag: NativeTag) {
      if (this.instance) this.instance.addNode(tag)
    }

    getImpactedFiles(symbolName: string): string[] {
      if (this.instance) return this.instance.getImpactedFiles(symbolName)
      return []
    }

    clear() {
      if (this.instance) this.instance.clear()
    }
  }

  /**
   * Vector store for semantic search.
   */
  export class VectorStore {
    private instance: any

    constructor() {
      const bnd = getBinding()
      if (bnd?.VectorStore) {
        this.instance = new bnd.VectorStore()
      }
    }

    add(tag: NativeTag, embedding: number[]) {
      if (this.instance) this.instance.add(tag, embedding)
    }

    search(queryEmbedding: number[], limit: number = 10): SearchResult[] {
      if (this.instance) return this.instance.search(queryEmbedding, limit)
      return []
    }

    clear() {
      if (this.instance) this.instance.clear()
    }

    size(): number {
      if (this.instance) return this.instance.size()
      return 0
    }
  }

  /**
   * High-performance codebase scan using multi-threaded Rust.
   */
  export async function scanCodebase(root: string): Promise<NativeTag[]> {
    const bnd = getBinding()
    if (bnd?.scanCodebase) return bnd.scanCodebase(root)
    return []
  }

  /**
   * High performance sum using Rust.
   */
  export function sum(a: number, b: number): number {
    const bnd = getBinding()
    if (bnd?.sum) return bnd.sum(a, b)
    return a + b
  }
}



