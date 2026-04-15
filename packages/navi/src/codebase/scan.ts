import { Language, Parser, Query } from "web-tree-sitter"
import { lazy } from "@/util/lazy"
import { fileURLToPath } from "url"
import fs from "fs"
import path from "path"

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
      const queryText = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "query", "typescript.scm"), "utf8")
      const query = new Query(lang, queryText)
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
      const queryText = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "query", "typescript.scm"), "utf8")
      const query = new Query(lang, queryText)
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
      const queryText = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "query", "python.scm"), "utf8")
      const query = new Query(lang, queryText)
      return { parser: p, query }
    }),
  }

  export async function file(filePath: string): Promise<Tag[]> {
    const ext = path.extname(filePath).slice(1)
    const loader = (languages as any)[ext === "ts" ? "typescript" : ext]
    if (!loader) return []

    const { parser, query } = await loader()
    const content = fs.readFileSync(filePath, "utf8")
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

