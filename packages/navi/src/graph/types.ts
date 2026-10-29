/**
 * Code Knowledge Graph Types
 * Aligned with Graphify schema (nodes, edges, communities, blast-radius impact)
 */

export interface CodeNode {
  id: string
  label: string
  source_file: string
  source_location?: string
  node_type: "file" | "function" | "class" | "interface" | "module" | "type" | "unknown"
  community?: number
  degree?: number
}

export interface CodeEdge {
  source: string
  target: string
  relation: "calls" | "imports" | "defines" | "references" | "extends" | "implements" | "uses" | "contains"
  confidence?: "EXTRACTED" | "INFERRED" | "AMBIGUOUS"
}

export interface AffectedHit {
  node_id: string
  label: string
  source_file: string
  depth: number
  via_relation: string
}

export interface PathStep {
  node_id: string
  label: string
  source_file: string
  relation_to_next?: string
}

export interface CycleInfo {
  path: string[]
  length: number
}

export interface GraphAnalysisResult {
  total_nodes: number
  total_edges: number
  god_nodes: CodeNode[]
  cycles: CycleInfo[]
  communities: Record<number, string[]>
  surprising_connections: CodeEdge[]
}

export interface CodeGraphData {
  nodes: CodeNode[]
  edges: CodeEdge[]
}
