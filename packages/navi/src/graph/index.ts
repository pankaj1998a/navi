/**
 * Navi Knowledge Graph & Code Intelligence Engine
 * Inspired by Graphify — backed by Rust Native FFI acceleration.
 */

import fs from "node:fs"
import path from "node:path"
import { extractGraph } from "./extract"
import type {
  CodeGraphData,
  GraphAnalysisResult,
  AffectedHit,
  PathStep,
  CodeNode,
  CodeEdge,
} from "./types"
import { native } from "../memory/native"

export interface GraphBuildResult {
  graph: CodeGraphData
  analysis: GraphAnalysisResult
  graphJsonPath: string
  reportPath: string
}

export function getGraphDir(rootDir = process.cwd()): string {
  return path.resolve(rootDir, "graphify-out")
}

export function getGraphJsonPath(rootDir = process.cwd()): string {
  return path.join(getGraphDir(rootDir), "graph.json")
}

export function loadSavedGraph(rootDir = process.cwd()): CodeGraphData | null {
  const p = getGraphJsonPath(rootDir)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

export function buildCodeGraph(options: {
  rootDir?: string
  maxFiles?: number
} = {}): GraphBuildResult {
  const rootDir = path.resolve(options.rootDir || process.cwd())
  const outDir = getGraphDir(rootDir)
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  const repoName = path.basename(rootDir)
  const graph = extractGraph({ rootDir, maxFiles: options.maxFiles })

  const nodesJson = JSON.stringify(graph.nodes)
  const edgesJson = JSON.stringify(graph.edges)

  let analysis: GraphAnalysisResult
  let reportText: string

  if (native.isAvailable && native.analyzeGraph && native.generateGraphReport) {
    analysis = native.analyzeGraph(nodesJson, edgesJson)
    reportText = native.generateGraphReport(nodesJson, edgesJson, repoName)
  } else {
    // Pure TypeScript fallback
    analysis = fallbackAnalyze(graph.nodes, graph.edges)
    reportText = fallbackGenerateReport(graph.nodes, graph.edges, analysis, repoName)
  }

  const graphJsonPath = path.join(outDir, "graph.json")
  const reportPath = path.join(outDir, "GRAPH_REPORT.md")

  fs.writeFileSync(graphJsonPath, JSON.stringify(graph, null, 2), "utf8")
  fs.writeFileSync(reportPath, reportText, "utf8")

  return {
    graph,
    analysis,
    graphJsonPath,
    reportPath,
  }
}

export function queryCodeGraph(
  question: string,
  options: { rootDir?: string; depth?: number; budget?: number } = {},
): string {
  const rootDir = path.resolve(options.rootDir || process.cwd())
  let graph = loadSavedGraph(rootDir)
  if (!graph) {
    const built = buildCodeGraph({ rootDir })
    graph = built.graph
  }

  const nodesJson = JSON.stringify(graph.nodes)
  const edgesJson = JSON.stringify(graph.edges)

  if (native.isAvailable && native.queryGraph) {
    return native.queryGraph(
      nodesJson,
      edgesJson,
      question,
      options.depth ?? 3,
      options.budget ?? 2000,
    )
  }

  return fallbackQuery(graph.nodes, graph.edges, question, options.depth ?? 3)
}

export function getAffectedNodes(
  seed: string,
  options: { rootDir?: string; depth?: number } = {},
): AffectedHit[] {
  const rootDir = path.resolve(options.rootDir || process.cwd())
  let graph = loadSavedGraph(rootDir)
  if (!graph) {
    const built = buildCodeGraph({ rootDir })
    graph = built.graph
  }

  const nodesJson = JSON.stringify(graph.nodes)
  const edgesJson = JSON.stringify(graph.edges)

  if (native.isAvailable && native.affectedGraph) {
    return native.affectedGraph(nodesJson, edgesJson, seed, options.depth ?? 2)
  }

  return fallbackAffected(graph.nodes, graph.edges, seed, options.depth ?? 2)
}

export function findShortestPath(
  from: string,
  to: string,
  options: { rootDir?: string } = {},
): PathStep[] | null {
  const rootDir = path.resolve(options.rootDir || process.cwd())
  let graph = loadSavedGraph(rootDir)
  if (!graph) {
    const built = buildCodeGraph({ rootDir })
    graph = built.graph
  }

  const nodesJson = JSON.stringify(graph.nodes)
  const edgesJson = JSON.stringify(graph.edges)

  if (native.isAvailable && native.shortestPathGraph) {
    return native.shortestPathGraph(nodesJson, edgesJson, from, to)
  }

  return fallbackShortestPath(graph.nodes, graph.edges, from, to)
}

export function generateWiki(options: {
  rootDir?: string
  outputDir?: string
} = {}): { indexFile: string; articleCount: number } {
  const rootDir = path.resolve(options.rootDir || process.cwd())
  const outDir = path.resolve(options.outputDir || path.join(rootDir, "graphify-out", "wiki"))
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  let graph = loadSavedGraph(rootDir)
  if (!graph) {
    const built = buildCodeGraph({ rootDir })
    graph = built.graph
  }

  const nodesJson = JSON.stringify(graph.nodes)
  const edgesJson = JSON.stringify(graph.edges)
  const analysis: GraphAnalysisResult =
    native.isAvailable && native.analyzeGraph
      ? native.analyzeGraph(nodesJson, edgesJson)
      : fallbackAnalyze(graph.nodes, graph.edges)

  const nodeMap = new Map<string, CodeNode>()
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n)
  }

  let indexDoc = `# Architecture Knowledge Wiki: ${path.basename(rootDir)}\n\n`
  indexDoc += `Auto-generated architecture documentation based on graph communities.\n\n`
  indexDoc += `## Communities & Functional Domains\n\n`

  let articleCount = 0
  for (const [commId, memberIds] of Object.entries(analysis.communities)) {
    articleCount++
    const articleFilename = `community_${commId}.md`
    const articlePath = path.join(outDir, articleFilename)

    indexDoc += `- [Community ${commId}: ${memberIds.length} entities](./${articleFilename})\n`

    let articleDoc = `# Architecture Domain: Community ${commId}\n\n`
    articleDoc += `Contains ${memberIds.length} cohesive entities.\n\n`
    articleDoc += `## Domain Entities\n\n`
    articleDoc += `| Label | Type | File |\n| :--- | :--- | :--- |\n`

    for (const mid of memberIds) {
      const node = nodeMap.get(mid)
      if (node) {
        articleDoc += `| \`${node.label}\` | ${node.node_type} | \`${node.source_file}\` |\n`
      }
    }

    fs.writeFileSync(articlePath, articleDoc, "utf8")
  }

  const indexFile = path.join(outDir, "index.md")
  fs.writeFileSync(indexFile, indexDoc, "utf8")

  return { indexFile, articleCount }
}

// ----------------- Pure TypeScript Fallbacks -----------------

function fallbackAnalyze(nodes: CodeNode[], edges: CodeEdge[]): GraphAnalysisResult {
  const nodeDegrees = new Map<string, number>()
  for (const n of nodes) nodeDegrees.set(n.id, 0)
  for (const e of edges) {
    nodeDegrees.set(e.source, (nodeDegrees.get(e.source) || 0) + 1)
    nodeDegrees.set(e.target, (nodeDegrees.get(e.target) || 0) + 1)
  }

  const sortedNodes = [...nodes].sort(
    (a, b) => (nodeDegrees.get(b.id) || 0) - (nodeDegrees.get(a.id) || 0),
  )

  const god_nodes = sortedNodes.slice(0, 10).map((n) => ({
    ...n,
    degree: nodeDegrees.get(n.id) || 0,
  }))

  const communities: Record<number, string[]> = {
    0: nodes.map((n) => n.id),
  }

  return {
    total_nodes: nodes.length,
    total_edges: edges.length,
    god_nodes,
    cycles: [],
    communities,
    surprising_connections: [],
  }
}

function fallbackGenerateReport(
  nodes: CodeNode[],
  edges: CodeEdge[],
  analysis: GraphAnalysisResult,
  repoName: string,
): string {
  return `# Architecture Knowledge Graph Report: ${repoName}

Generated by Navi Graph Engine (TypeScript Fallback).

## 1. Executive Metrics

- **Total Entities (Nodes):** ${nodes.length}
- **Total Relationships (Edges):** ${edges.length}
- **Identified Communities:** ${Object.keys(analysis.communities).length}

## 2. God Nodes (Core Architectural Hubs)

${analysis.god_nodes.map((g) => `- \`${g.label}\` (${g.node_type}) in \`${g.source_file}\` (degree: ${g.degree || 0})`).join("\n")}
`
}

function fallbackQuery(
  nodes: CodeNode[],
  edges: CodeEdge[],
  question: string,
  depth: number,
): string {
  const qLower = question.toLowerCase()
  const matched = nodes.filter(
    (n) => n.label.toLowerCase().includes(qLower) || n.source_file.toLowerCase().includes(qLower),
  )
  if (matched.length === 0) return `No matching entities found for: "${question}"`

  return `### Architectural Context for: "${question}"
Found ${matched.length} entities matching query:
${matched.map((m) => `- \`${m.label}\` (${m.node_type}) in \`${m.source_file}\``).join("\n")}`
}

function fallbackAffected(
  nodes: CodeNode[],
  edges: CodeEdge[],
  seed: string,
  depth: number,
): AffectedHit[] {
  const reverseMap = new Map<string, Array<{ source: string; rel: string }>>()
  for (const e of edges) {
    const list = reverseMap.get(e.target) || []
    list.push({ source: e.source, rel: e.relation })
    reverseMap.set(e.target, list)
  }

  const hits: AffectedHit[] = []
  const visited = new Set<string>([seed])
  const queue: Array<{ id: string; d: number }> = [{ id: seed, d: 0 }]

  const nodeMap = new Map<string, CodeNode>()
  for (const n of nodes) nodeMap.set(n.id, n)

  while (queue.length > 0) {
    const { id, d } = queue.shift()!
    if (d >= depth) continue

    const incoming = reverseMap.get(id) || []
    for (const inc of incoming) {
      if (!visited.has(inc.source)) {
        visited.add(inc.source)
        const node = nodeMap.get(inc.source)
        hits.push({
          node_id: inc.source,
          label: node ? node.label : inc.source,
          source_file: node ? node.source_file : "",
          depth: d + 1,
          via_relation: inc.rel,
        })
        queue.push({ id: inc.source, d: d + 1 })
      }
    }
  }

  return hits
}

function fallbackShortestPath(
  nodes: CodeNode[],
  edges: CodeEdge[],
  from: string,
  to: string,
): PathStep[] | null {
  const forwardMap = new Map<string, Array<{ target: string; rel: string }>>()
  for (const e of edges) {
    const list = forwardMap.get(e.source) || []
    list.push({ target: e.target, rel: e.relation })
    forwardMap.set(e.source, list)
  }

  const queue: string[] = [from]
  const visited = new Set<string>([from])
  const parent = new Map<string, { prev: string; rel: string }>()

  let found = false
  while (queue.length > 0) {
    const curr = queue.shift()!
    if (curr === to) {
      found = true
      break
    }
    const neighbors = forwardMap.get(curr) || []
    for (const n of neighbors) {
      if (!visited.has(n.target)) {
        visited.add(n.target)
        parent.set(n.target, { prev: curr, rel: n.rel })
        queue.push(n.target)
      }
    }
  }

  if (!found) return null

  const steps: PathStep[] = []
  let curr = to
  const nodeMap = new Map<string, CodeNode>()
  for (const n of nodes) nodeMap.set(n.id, n)

  while (curr !== from) {
    const p = parent.get(curr)!
    const node = nodeMap.get(curr)
    steps.unshift({
      node_id: curr,
      label: node ? node.label : curr,
      source_file: node ? node.source_file : "",
    })
    curr = p.prev
  }

  const startNode = nodeMap.get(from)
  steps.unshift({
    node_id: from,
    label: startNode ? startNode.label : from,
    source_file: startNode ? startNode.source_file : "",
  })

  return steps
}
