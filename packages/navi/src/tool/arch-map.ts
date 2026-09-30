import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
import DESCRIPTION from "./arch-map.txt"

const log = Log.create({ service: "tool.arch-map" })

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Relative or absolute directory or file path to analyze (defaults to workspace root)",
  }),
  depth: Schema.optional(Schema.Number).annotate({
    description: "Maximum traversal depth (default 2)",
  }),
  format: Schema.Literals(["mermaid", "table", "json"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("mermaid" as const)))
    .annotate({
      description: "Output format: 'mermaid' (Mermaid diagram), 'table' (component list), or 'json'",
    }),
})

type DependencyEdge = {
  from: string
  to: string
  isExternal: boolean
}

function extractImports(filePath: string, content: string): string[] {
  const imports: string[] = []
  const ext = path.extname(filePath).toLowerCase()

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    // Match import ... from "..." and require("...")
    const importRegex = /(?:import\s+(?:[\w*\s{},]+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g
    let match
    while ((match = importRegex.exec(content)) !== null) {
      const target = match[1] || match[2]
      if (target) imports.push(target)
    }
  } else if (ext === ".py") {
    // Match import ... and from ... import ...
    const pyRegex = /(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g
    let match
    while ((match = pyRegex.exec(content)) !== null) {
      const target = match[1] || match[2]
      if (target) imports.push(target)
    }
  }

  return imports
}

function scanDependencies(dir: string, baseDir: string, maxDepth: number, currentDepth = 0): DependencyEdge[] {
  if (currentDepth > maxDepth || !fs.existsSync(dir)) return []

  const edges: DependencyEdge[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
      continue
    }

    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      edges.push(...scanDependencies(fullPath, baseDir, maxDepth, currentDepth + 1))
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx|py)$/.test(entry.name)) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8")
        const fromModule = path.relative(baseDir, fullPath).replace(/\\/g, "/")
        const targets = extractImports(fullPath, content)

        for (const target of targets) {
          const isExternal = !target.startsWith(".") && !target.startsWith("/") && !target.startsWith("@/")
          const cleanTarget = target.startsWith("@/") ? target.replace("@/", "src/") : target
          edges.push({
            from: fromModule,
            to: cleanTarget,
            isExternal,
          })
        }
      } catch {
        // ignore unreadable files
      }
    }
  }

  return edges
}

export const ArchMapTool = Tool.define(
  "arch_map",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const targetDir = params.path
            ? path.isAbsolute(params.path)
              ? params.path
              : path.resolve(instance.directory, params.path)
            : instance.directory

          yield* ctx.ask({
            permission: "arch_map",
            patterns: [params.path ?? "*"],
            always: ["*"],
            metadata: { path: targetDir },
          })

          const depth = params.depth ?? 2
          const edges = scanDependencies(targetDir, instance.directory, depth)

          // Group by module directories for cleaner high-level diagrams
          const moduleMap = new Map<string, Set<string>>()
          for (const edge of edges) {
            const fromMod = edge.from.split("/").slice(0, 2).join("/")
            const toMod = edge.isExternal ? `pkg:${edge.to.split("/")[0]}` : edge.to.split("/").slice(0, 2).join("/")
            if (fromMod === toMod) continue

            if (!moduleMap.has(fromMod)) moduleMap.set(fromMod, new Set())
            moduleMap.get(fromMod)!.add(toMod)
          }

          if (params.format === "json") {
            const raw = Object.fromEntries(Array.from(moduleMap.entries()).map(([k, v]) => [k, Array.from(v)]))
            return {
              title: "Architecture Map (JSON)",
              output: `\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\``,
              metadata: { edgeCount: edges.length } as Record<string, unknown>,
            }
          }

          // Build Mermaid diagram
          const mermaidLines: string[] = ["```mermaid", "graph TD"]
          const sanitizedId = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, "_")

          for (const [fromMod, targets] of moduleMap.entries()) {
            const fromId = sanitizedId(fromMod)
            mermaidLines.push(`  ${fromId}["📁 ${fromMod}"]`)
            for (const toMod of targets) {
              const toId = sanitizedId(toMod)
              if (toMod.startsWith("pkg:")) {
                const pkgName = toMod.slice(4)
                mermaidLines.push(`  ${toId}["📦 ${pkgName}"]:::external`)
              } else {
                mermaidLines.push(`  ${toId}["📁 ${toMod}"]`)
              }
              mermaidLines.push(`  ${fromId} --> ${toId}`)
            }
          }
          mermaidLines.push("  classDef external fill:#1e293b,stroke:#64748b,color:#94a3b8;")
          mermaidLines.push("```")

          const relPath = path.relative(instance.worktree, targetDir) || "root"

          const output = [
            `# 📊 Architecture Dependency Map: \`${relPath}\``,
            "",
            "## Visual Component Flow",
            mermaidLines.join("\n"),
            "",
            "## Summary Table",
            "| Component / Module | Dependencies |",
            "| :--- | :--- |",
            ...Array.from(moduleMap.entries()).map(
              ([mod, tgts]) => `| **${mod}** | ${Array.from(tgts).map((t) => `\`${t}\``).join(", ")} |`,
            ),
          ].join("\n")

          return {
            title: `Architecture Map: ${relPath}`,
            output,
            metadata: {
              targetDir,
              modulesCount: moduleMap.size,
              edgesCount: edges.length,
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)
