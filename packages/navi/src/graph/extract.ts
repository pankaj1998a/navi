/**
 * Codebase Entity & Dependency Extractor
 * Extracts files, classes, functions, interfaces, imports, and calls
 * across TypeScript, JavaScript, Rust, Python, and package manifests.
 */

import fs from "node:fs"
import path from "node:path"
import type { CodeNode, CodeEdge, CodeGraphData } from "./types"

const NOISE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "target",
  ".turbo",
  ".opencode",
  ".navi",
  ".gemini",
  "build",
  "coverage",
  ".cache",
  "graphify-out",
  "scratch",
  "scratch_agency_agents",
  "scratch_cf_sec",
  "scratch_graphify",
])

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rs",
  ".py",
  ".go",
  ".json",
])

export interface ExtractOptions {
  maxFiles?: number
  rootDir: string
}

export function collectCodeFiles(
  dir: string,
  rootDir: string,
  filesList: string[] = [],
  maxFiles = 1000,
): string[] {
  if (filesList.length >= maxFiles) return filesList

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (filesList.length >= maxFiles) break

      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!NOISE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          collectCodeFiles(fullPath, rootDir, filesList, maxFiles)
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()

        if (CODE_EXTENSIONS.has(ext)) {
          filesList.push(fullPath)
        }
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return filesList
}

export function extractGraph(options: ExtractOptions): CodeGraphData {
  const rootDir = path.resolve(options.rootDir)
  const filePaths = collectCodeFiles(rootDir, rootDir, [], options.maxFiles || 1000)

  const nodes: CodeNode[] = []
  const edges: CodeEdge[] = []
  const fileNodeMap = new Map<string, string>()
  const knownFiles = new Set<string>()

  for (const filePath of filePaths) {
    const relPath = path.relative(rootDir, filePath).replace(/\\/g, "/")
    knownFiles.add(relPath)
    fileNodeMap.set(relPath, relPath)
  }

  for (const filePath of filePaths) {
    const relPath = path.relative(rootDir, filePath).replace(/\\/g, "/")
    const fileId = relPath
    const fileName = path.basename(filePath)

    // Register File Node
    nodes.push({
      id: fileId,
      label: fileName,
      source_file: relPath,
      source_location: "L1",
      node_type: "file",
    })

    try {
      const content = fs.readFileSync(filePath, "utf8")
      const ext = path.extname(filePath).toLowerCase()

      if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
        extractJsTs(relPath, content, nodes, edges, knownFiles)
      } else if (ext === ".rs") {
        extractRust(relPath, content, nodes, edges)
      } else if (ext === ".py") {
        extractPython(relPath, content, nodes, edges)
      } else if (fileName === "package.json") {
        extractPackageJson(relPath, content, edges)
      }
    } catch {
      // Skip unreadable files
    }
  }

  return { nodes, edges }
}

function extractJsTs(
  relPath: string,
  content: string,
  nodes: CodeNode[],
  edges: CodeEdge[],
  knownFiles: Set<string>,
) {
  // 1. Imports: import ... from '...' | require('...')
  const importRegex = /(?:import\s+(?:[\w*\s{},$]+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g
  let match: RegExpExecArray | null

  while ((match = importRegex.exec(content)) !== null) {
    const importTarget = match[1] || match[2]

    if (importTarget && !importTarget.startsWith("node:")) {
      let resolvedTarget = importTarget

      if (importTarget.startsWith(".")) {
        const fileDir = path.dirname(relPath)
        let normalized = path.normalize(path.join(fileDir, importTarget)).replace(/\\/g, "/")

        if (normalized.startsWith("./")) normalized = normalized.slice(2)
        resolvedTarget = normalized

        for (const ext of [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"]) {
          if (knownFiles.has(normalized + ext)) {
            resolvedTarget = normalized + ext
            break
          }
        }
      }

      edges.push({
        source: relPath,
        target: resolvedTarget,
        relation: "imports",
        confidence: "EXTRACTED",
      })
    }
  }

  // 2. Class definitions: class Bar [extends Foo] [implements Baz]
  const classRegex = /class\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$]+))?(?:\s+implements\s+([A-Za-z0-9_$,\s]+))?/g

  while ((match = classRegex.exec(content)) !== null) {
    const className = match[1]

    if (!className) continue

    const extendsName = match[2]
    const implementsNames = match[3]
    const classId = `${relPath}::${className}`

    nodes.push({
      id: classId,
      label: className,
      source_file: relPath,
      node_type: "class",
    })

    edges.push({
      source: relPath,
      target: classId,
      relation: "defines",
      confidence: "EXTRACTED",
    })

    if (extendsName) {
      edges.push({
        source: classId,
        target: extendsName,
        relation: "extends",
        confidence: "INFERRED",
      })
    }

    if (implementsNames) {
      for (const impl of implementsNames.split(",")) {
        const trimmed = impl.trim()

        if (trimmed) {
          edges.push({
            source: classId,
            target: trimmed,
            relation: "implements",
            confidence: "INFERRED",
          })
        }
      }
    }
  }

  // 3. Interface & Type definitions
  const typeRegex = /(?:interface|type)\s+([A-Za-z0-9_$]+)/g

  while ((match = typeRegex.exec(content)) !== null) {
    const typeName = match[1]

    if (!typeName) continue

    const typeId = `${relPath}::${typeName}`

    nodes.push({
      id: typeId,
      label: typeName,
      source_file: relPath,
      node_type: "interface",
    })

    edges.push({
      source: relPath,
      target: typeId,
      relation: "defines",
      confidence: "EXTRACTED",
    })
  }

  // 4. Function definitions: function foo() | export function foo() | const foo = (...) =>
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/g

  while ((match = funcRegex.exec(content)) !== null) {
    const funcName = match[1] || match[2]

    if (funcName && !["if", "for", "while", "switch"].includes(funcName)) {
      const funcId = `${relPath}::${funcName}`

      nodes.push({
        id: funcId,
        label: `${funcName}()`,
        source_file: relPath,
        node_type: "function",
      })

      edges.push({
        source: relPath,
        target: funcId,
        relation: "defines",
        confidence: "EXTRACTED",
      })
    }
  }
}

function extractRust(
  relPath: string,
  content: string,
  nodes: CodeNode[],
  edges: CodeEdge[],
) {
  let match: RegExpExecArray | null

  // 1. Module imports: use ...;
  const useRegex = /use\s+([a-zA-Z0-9_:]+)(?:::\{[^}]+\})?;/g

  while ((match = useRegex.exec(content)) !== null) {
    const useTarget = match[1]

    if (!useTarget) continue

    edges.push({
      source: relPath,
      target: useTarget,
      relation: "imports",
      confidence: "EXTRACTED",
    })
  }

  // 2. Struct, Enum, Trait definitions
  const defRegex = /(?:pub\s+)?(?:struct|enum|trait)\s+([a-zA-Z0-9_]+)/g

  while ((match = defRegex.exec(content)) !== null) {
    const name = match[1]

    if (!name) continue

    const defId = `${relPath}::${name}`

    nodes.push({
      id: defId,
      label: name,
      source_file: relPath,
      node_type: "class",
    })

    edges.push({
      source: relPath,
      target: defId,
      relation: "defines",
      confidence: "EXTRACTED",
    })
  }

  // 3. Function definitions
  const fnRegex = /(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/g

  while ((match = fnRegex.exec(content)) !== null) {
    const fnName = match[1]

    if (!fnName) continue

    const fnId = `${relPath}::${fnName}`

    nodes.push({
      id: fnId,
      label: `${fnName}()`,
      source_file: relPath,
      node_type: "function",
    })

    edges.push({
      source: relPath,
      target: fnId,
      relation: "defines",
      confidence: "EXTRACTED",
    })
  }
}

function extractPython(
  relPath: string,
  content: string,
  nodes: CodeNode[],
  edges: CodeEdge[],
) {
  let match: RegExpExecArray | null

  // 1. Imports: import foo | from foo import bar
  const importRegex = /(?:^|\n)(?:from\s+([a-zA-Z0-9_.]+)\s+import|import\s+([a-zA-Z0-9_.]+))/g

  while ((match = importRegex.exec(content)) !== null) {
    const mod = match[1] || match[2]

    if (mod) {
      edges.push({
        source: relPath,
        target: mod,
        relation: "imports",
        confidence: "EXTRACTED",
      })
    }
  }

  // 2. Class definitions
  const classRegex = /(?:^|\n)class\s+([a-zA-Z0-9_]+)(?:\(([^)]+)\))?:/g

  while ((match = classRegex.exec(content)) !== null) {
    const className = match[1]

    if (!className) continue

    const superClasses = match[2]
    const classId = `${relPath}::${className}`

    nodes.push({
      id: classId,
      label: className,
      source_file: relPath,
      node_type: "class",
    })

    edges.push({
      source: relPath,
      target: classId,
      relation: "defines",
      confidence: "EXTRACTED",
    })

    if (superClasses) {
      for (const sup of superClasses.split(",")) {
        const trimmed = sup.trim()

        if (trimmed && trimmed !== "object") {
          edges.push({
            source: classId,
            target: trimmed,
            relation: "extends",
            confidence: "INFERRED",
          })
        }
      }
    }
  }

  // 3. Function definitions
  const funcRegex = /(?:^|\n)\s*def\s+([a-zA-Z0-9_]+)\s*\(/g

  while ((match = funcRegex.exec(content)) !== null) {
    const fnName = match[1]

    if (!fnName) continue

    const fnId = `${relPath}::${fnName}`

    nodes.push({
      id: fnId,
      label: `${fnName}()`,
      source_file: relPath,
      node_type: "function",
    })

    edges.push({
      source: relPath,
      target: fnId,
      relation: "defines",
      confidence: "EXTRACTED",
    })
  }
}

function extractPackageJson(
  relPath: string,
  content: string,
  edges: CodeEdge[],
) {
  try {
    const pkg = JSON.parse(content)

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }

    for (const dep of Object.keys(allDeps)) {
      edges.push({
        source: relPath,
        target: dep,
        relation: "imports",
        confidence: "EXTRACTED",
      })
    }
  } catch {
    // Ignore invalid JSON
  }
}
