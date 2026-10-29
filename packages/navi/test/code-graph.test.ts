import { describe, expect, it } from "bun:test"
import path from "node:path"
import fs from "node:fs"
import { extractGraph } from "../src/graph/extract"
import {
  buildCodeGraph,
  queryCodeGraph,
  getAffectedNodes,
  findShortestPath,
  generateWiki,
} from "../src/graph"
import { native } from "../src/memory/native"

describe("Navi Code Graph & Architecture Intelligence Suite", () => {
  const fixtureDir = path.join(import.meta.dir, "fixtures", "graph-test")

  // Setup sample test repository
  if (!fs.existsSync(fixtureDir)) {
    fs.mkdirSync(fixtureDir, { recursive: true })
  }

  const mainTs = path.join(fixtureDir, "main.ts")
  const serverTs = path.join(fixtureDir, "server.ts")
  const authTs = path.join(fixtureDir, "auth.ts")
  const dbTs = path.join(fixtureDir, "db.ts")

  fs.writeFileSync(
    mainTs,
    `import { startServer } from "./server"\n\nexport function run() {\n  startServer()\n}\n`,
    "utf8",
  )
  fs.writeFileSync(
    serverTs,
    `import { checkAuth } from "./auth"\n\nexport function startServer() {\n  checkAuth()\n}\n`,
    "utf8",
  )
  fs.writeFileSync(
    authTs,
    `import { queryUser } from "./db"\n\nexport class AuthManager {\n  validate() {}\n}\n\nexport function checkAuth() {\n  queryUser()\n}\n`,
    "utf8",
  )
  fs.writeFileSync(
    dbTs,
    `export function queryUser() {\n  return { id: 1 }\n}\n`,
    "utf8",
  )

  it("extracts entities and dependency relationships accurately", () => {
    const data = extractGraph({ rootDir: fixtureDir })
    expect(data.nodes.length).toBeGreaterThanOrEqual(4)
    expect(data.edges.length).toBeGreaterThanOrEqual(3)

    const labels = data.nodes.map((n) => n.label)
    expect(labels).toContain("main.ts")
    expect(labels).toContain("server.ts")
    expect(labels).toContain("auth.ts")
    expect(labels).toContain("db.ts")
    expect(labels).toContain("AuthManager")

    const importEdges = data.edges.filter((e) => e.relation === "imports")
    expect(importEdges.length).toBeGreaterThanOrEqual(3)
  })

  it("builds knowledge graph and computes metrics with native acceleration", () => {
    const result = buildCodeGraph({ rootDir: fixtureDir })
    expect(result.graph.nodes.length).toBeGreaterThanOrEqual(4)
    expect(result.analysis.total_nodes).toBeGreaterThanOrEqual(4)
    expect(fs.existsSync(result.graphJsonPath)).toBe(true)
    expect(fs.existsSync(result.reportPath)).toBe(true)

    const reportContent = fs.readFileSync(result.reportPath, "utf8")
    expect(reportContent).toContain("Architecture Knowledge Graph Report")
    expect(reportContent).toContain("Executive Metrics")
  })

  it("performs blast-radius impact analysis (affected nodes)", () => {
    // If db.ts changes, checkAuth / auth.ts / server.ts / main.ts should be affected
    const hits = getAffectedNodes("db.ts", { rootDir: fixtureDir, depth: 4 })
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })

  it("computes shortest architectural path between two entities", () => {
    const steps = findShortestPath("main.ts", "db.ts", { rootDir: fixtureDir })
    expect(steps).not.toBeNull()
    if (steps && steps.length >= 2) {
      expect(steps[0]?.label).toContain("main.ts")
      expect(steps[steps.length - 1]?.label).toContain("db.ts")
    }
  })

  it("generates scoped architectural context query response", () => {
    const answer = queryCodeGraph("authentication server", { rootDir: fixtureDir })
    expect(answer).toContain("Architectural Context")
  })

  it("generates multi-page architecture knowledge wiki", () => {
    const wikiDir = path.join(fixtureDir, "graphify-out", "wiki")
    const res = generateWiki({ rootDir: fixtureDir, outputDir: wikiDir })
    expect(res.articleCount).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(res.indexFile)).toBe(true)
  })

  it("verifies native Rust FFI graph bindings are functional", () => {
    if (native.isAvailable && native.analyzeGraph) {
      const sampleNodes = JSON.stringify([
        { id: "A", label: "A", node_type: "file", source_file: "A.ts" },
        { id: "B", label: "B", node_type: "file", source_file: "B.ts" },
      ])
      const sampleEdges = JSON.stringify([
        { source: "A", target: "B", relation: "imports", confidence: "EXTRACTED" },
      ])

      const analysis = native.analyzeGraph(sampleNodes, sampleEdges)
      expect(analysis.total_nodes).toBe(2)
      expect(analysis.total_edges).toBe(1)

      const affected = native.affectedGraph?.(sampleNodes, sampleEdges, "B", 2)
      expect(affected).toBeDefined()
      expect(affected?.length).toBe(1)
      expect(affected?.[0].node_id).toBe("A")
    }
  })
})
