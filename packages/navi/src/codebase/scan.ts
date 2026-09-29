import { Language, Parser, Query } from "web-tree-sitter"
import { lazy } from "@/util/lazy"
import { fileURLToPath } from "url"
import fs from "fs"
import path from "path"

// Hoisted: query files are static — read once, not per language init.
// TODO: move to Bun.file + async init if this ever runs on hot path.
const queryDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "query")
const queryTextCache = new Map<string, string>()
function queryText(name: string): string {
  const hit = queryTextCache.get(name)
  if (hit !== undefined) return hit
  const text = fs.readFileSync(path.join(queryDir, name), "utf8")
  queryTextCache.set(name, text)
  return text
}

// Cap single-file parse size to avoid blocking on huge generated files.
export const MAX_SCAN_BYTES = 512 * 1024

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const ParserInit = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  return Parser
})

export namespace Scan {
  export interface Tag {
    name: string
    type: string
    line: number
  }

  const languages = {
    typescript: lazy(async () => {
      const { default: wasm } = await import("tree-sitter-typescript/tree-sitter-typescript.wasm" as string, {
        with: { type: "wasm" },
      })
      const lang = await Language.load(resolveWasm(wasm))
      const P = await ParserInit()
      const p = new P()
      p.setLanguage(lang)
      const query = new Query(lang, queryText("typescript.scm"))
      return { parser: p, query }
    }),
    tsx: lazy(async () => {
      const { default: wasm } = await import("tree-sitter-typescript/tree-sitter-tsx.wasm" as string, {
        with: { type: "wasm" },
      })
      const lang = await Language.load(resolveWasm(wasm))
      const P = await ParserInit()
      const p = new P()
      p.setLanguage(lang)
      const query = new Query(lang, queryText("typescript.scm"))
      return { parser: p, query }
    }),
    python: lazy(async () => {
      const { default: wasm } = await import("tree-sitter-python/tree-sitter-python.wasm" as string, {
        with: { type: "wasm" },
      })
      const lang = await Language.load(resolveWasm(wasm))
      const P = await ParserInit()
      const p = new P()
      p.setLanguage(lang)
      const query = new Query(lang, queryText("python.scm"))
      return { parser: p, query }
    }),
  }

  export async function file(filePath: string): Promise<Tag[]> {
    const ext = path.extname(filePath).slice(1)
    const loader = (languages as any)[ext === "ts" ? "typescript" : ext]
    if (!loader) return []

    const { parser, query } = await loader()
    // Async read + size cap: skip huge files instead of blocking the loop.
    const stat = await fs.promises.stat(filePath).catch(() => undefined)
    if (!stat || stat.size > MAX_SCAN_BYTES) return []
    const content = await fs.promises.readFile(filePath, "utf8")
    const tree = parser.parse(content)
    const captures = query.captures(tree.rootNode)

    const tags: Tag[] = []
    for (const capture of captures) {
      if (capture.name === "identifier") {
        tags.push({
          name: capture.node.text,
          type: capture.node.parent?.type || "unknown",
          line: capture.node.startPosition.row + 1,
        })
      }
    }
    return tags
  }
}

