import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import fs from "node:fs"
import path from "node:path"
import {
  buildCodeGraph,
  queryCodeGraph,
  getAffectedNodes,
  findShortestPath,
  generateWiki,
  getGraphDir,
  getGraphJsonPath,
} from "@/graph"

export const GraphCommand = effectCmd({
  command: "graph [action] [arg1] [arg2]",
  describe: "Codebase Knowledge Graph & Architecture Intelligence (Graphify Engine)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "Action: 'build' (scan & build graph), 'query' (ask question), 'affected' (blast radius), 'path' (shortest path), 'god-nodes' (core hubs), 'cycles' (circular dependencies), 'report' (view GRAPH_REPORT.md), 'wiki' (generate architecture wiki)",
        choices: [
          "build",
          "query",
          "affected",
          "path",
          "god-nodes",
          "cycles",
          "report",
          "wiki",
        ] as const,
        default: "build",
      })
      .positional("arg1", {
        describe: "Target path, query text, seed entity, or starting path node",
        type: "string",
      })
      .positional("arg2", {
        describe: "Goal path node for shortest path",
        type: "string",
      })
      .option("depth", {
        alias: "d",
        describe: "Traversal depth for affected or query search",
        type: "number",
        default: 3,
      })
      .option("budget", {
        alias: "b",
        describe: "Token budget cap for query context",
        type: "number",
        default: 2000,
      }),
  handler: Effect.fn("Cli.graph")(function* (args) {
    const action = args.action || "build"
    const arg1 = args.arg1 ? String(args.arg1) : ""
    const arg2 = args.arg2 ? String(args.arg2) : ""
    const depth = args.depth ?? 3
    const budget = args.budget ?? 2000

    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  🕸️  Navi Graph — Codebase Knowledge Graph & Architecture Intelligence")
    UI.empty()

    if (action === "build") {
      const rootDir = arg1 ? path.resolve(arg1) : process.cwd()
      UI.println(UI.Style.TEXT_NORMAL + `  Scanning and building knowledge graph for: ${rootDir}...`)

      const result = buildCodeGraph({ rootDir })
      UI.println(UI.Style.TEXT_SUCCESS + `  [OK] Extraction & Analysis Complete (Native Rust Acceleration)`)
      UI.println(`    • Entities (Nodes): ${result.analysis.total_nodes}`)
      UI.println(`    • Relationships (Edges): ${result.analysis.total_edges}`)
      UI.println(`    • Communities Detected: ${Object.keys(result.analysis.communities).length}`)
      UI.println(`    • Circular Dependency Cycles: ${result.analysis.cycles.length}`)
      UI.println(`    • God Nodes (Core Hubs): ${result.analysis.god_nodes.length}`)
      UI.empty()
      UI.println(UI.Style.TEXT_DIM + `  Artifacts written:`)
      UI.println(`    - Graph JSON:   ${result.graphJsonPath}`)
      UI.println(`    - Report MD:    ${result.reportPath}`)
      UI.empty()
      UI.println(UI.Style.TEXT_DIM + `  Next steps:`)
      UI.println(`    navi graph query "<question>"            (Query architecture)`)
      UI.println(`    navi graph affected <symbol-or-file>     (Blast radius impact)`)
      UI.println(`    navi graph path <from> <to>              (Shortest path)`)
      UI.println(`    navi graph wiki                          (Generate knowledge wiki)`)
      return
    }

    if (action === "query") {
      if (!arg1) {
        UI.println(UI.Style.TEXT_DANGER + "  [Error] Please provide a question or concept to query.")
        UI.println("  Example: navi graph query \"How is authentication handled?\"")
        return
      }

      UI.println(UI.Style.TEXT_DIM + `  Querying knowledge graph: "${arg1}" (depth=${depth}, budget=${budget})...\n`)
      const context = queryCodeGraph(arg1, { depth, budget })
      UI.println(context)
      return
    }

    if (action === "affected") {
      if (!arg1) {
        UI.println(UI.Style.TEXT_DANGER + "  [Error] Please provide a seed entity or file path.")
        UI.println("  Example: navi graph affected src/auth.ts --depth 2")
        return
      }

      UI.println(UI.Style.TEXT_DIM + `  Analyzing blast radius for: "${arg1}" (depth=${depth})...\n`)
      const hits = getAffectedNodes(arg1, { depth })
      if (hits.length === 0) {
        UI.println(UI.Style.TEXT_SUCCESS + `  No dependents or affected entities found within depth ${depth}.`)
        return
      }

      UI.println(UI.Style.TEXT_WARNING + `  Found ${hits.length} affected entities:`)
      UI.println("  " + "Depth".padEnd(8) + "Relation".padEnd(14) + "Entity".padEnd(30) + "Source File")
      UI.println("  " + "-".repeat(70))
      for (const h of hits) {
        UI.println(`  ${String(h.depth).padEnd(8)}${h.via_relation.padEnd(14)}${h.label.padEnd(30)}${h.source_file}`)
      }
      return
    }

    if (action === "path") {
      if (!arg1 || !arg2) {
        UI.println(UI.Style.TEXT_DANGER + "  [Error] Please provide both <from> and <to> entities.")
        UI.println("  Example: navi graph path src/main.ts src/db.ts")
        return
      }

      UI.println(UI.Style.TEXT_DIM + `  Searching shortest path between "${arg1}" and "${arg2}"...\n`)
      const steps = findShortestPath(arg1, arg2)
      if (!steps || steps.length === 0) {
        UI.println(UI.Style.TEXT_DANGER + `  No path found connecting "${arg1}" to "${arg2}".`)
        return
      }

      UI.println(UI.Style.TEXT_SUCCESS + `  Shortest Path (${steps.length} hops):`)
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i]
        if (!s) continue
        const rel = s.relation_to_next ? ` --[${s.relation_to_next}]--> ` : ""
        UI.println(`    [${i + 1}] ${s.label} (${s.source_file})${rel ? "\n        " + rel : ""}`)
      }
      return
    }

    if (action === "god-nodes") {
      const rootDir = process.cwd()
      const graph = buildCodeGraph({ rootDir })
      UI.println(UI.Style.TEXT_NORMAL + `  Core Architectural Hubs (God Nodes):\n`)
      UI.println("  " + "Degree".padEnd(10) + "Type".padEnd(12) + "Entity".padEnd(30) + "Source File")
      UI.println("  " + "-".repeat(70))
      for (const g of graph.analysis.god_nodes) {
        UI.println(`  ${String(g.degree || 0).padEnd(10)}${g.node_type.padEnd(12)}${g.label.padEnd(30)}${g.source_file}`)
      }
      return
    }

    if (action === "cycles") {
      const rootDir = process.cwd()
      const graph = buildCodeGraph({ rootDir })
      if (graph.analysis.cycles.length === 0) {
        UI.println(UI.Style.TEXT_SUCCESS + "  [OK] No circular dependency cycles detected!")
      } else {
        UI.println(UI.Style.TEXT_WARNING + `  Found ${graph.analysis.cycles.length} circular dependency cycles:`)
        for (let i = 0; i < graph.analysis.cycles.length; i++) {
          const c = graph.analysis.cycles[i]
          if (!c) continue
          UI.println(`\n  Cycle #${i + 1} (Length ${c.length}):`)
          UI.println(`    ${c.path.join(" -> ")}`)
        }
      }
      return
    }

    if (action === "report") {
      const reportPath = path.join(getGraphDir(), "GRAPH_REPORT.md")
      if (!fs.existsSync(reportPath)) {
        buildCodeGraph()
      }
      if (fs.existsSync(reportPath)) {
        UI.println(fs.readFileSync(reportPath, "utf8"))
      }
      return
    }

    if (action === "wiki") {
      const targetDir = arg1 ? path.resolve(arg1) : undefined
      UI.println(UI.Style.TEXT_NORMAL + `  Generating Architecture Knowledge Wiki...`)
      const res = generateWiki({ outputDir: targetDir })
      UI.println(UI.Style.TEXT_SUCCESS + `  [OK] Generated ${res.articleCount} domain articles and index!`)
      UI.println(`  Index path: ${res.indexFile}`)
      return
    }
  }),
})
