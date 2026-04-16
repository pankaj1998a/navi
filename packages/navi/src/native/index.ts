export * from './file-ops'
export * from './vcs'
export * from './tokens'
export * from './ast'
export * from './grep'
export * from './diff'
export * from './sysinfo'

// Rust-based native functions
// @ts-ignore
import rustLoader from './rust-loader.cjs'
import type * as Rust from './rust'

export const sum = rustLoader.sum as typeof Rust.sum
export const scanCodebase = rustLoader.scanCodebase as typeof Rust.scanCodebase
export const SymbolGraph = rustLoader.SymbolGraph as typeof Rust.SymbolGraph
export const VectorStore = rustLoader.VectorStore as typeof Rust.VectorStore
export type { Tag, SearchResult } from './rust'
