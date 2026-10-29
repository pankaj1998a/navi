import fs from "fs"
import path from "path"

const summary = {
  Rust: { files: 0, lines: 0, bytes: 0 },
  TypeScript: { files: 0, lines: 0, bytes: 0 },
  JavaScript: { files: 0, lines: 0, bytes: 0 },
  Markdown: { files: 0, lines: 0, bytes: 0 },
}

const ignored = new Set([
  "node_modules",
  "target",
  ".git",
  ".turbo",
  "dist",
  "build",
  "coverage",
  ".system_generated",
  "scratch",
])

function walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (ignored.has(ent.name)) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      walk(full)
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase()
      let cat = null
      if (ext === ".rs") cat = "Rust"
      else if (ext === ".ts" || ext === ".tsx") cat = "TypeScript"
      else if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") cat = "JavaScript"
      else if (ext === ".md" || ext === ".mdx") cat = "Markdown"

      if (cat) {
        try {
          const content = fs.readFileSync(full, "utf8")
          summary[cat].files++
          summary[cat].lines += content.split("\n").length
          summary[cat].bytes += content.length
        } catch {}
      }
    }
  }
}

walk("v:/pankaj/navi")

const totalCodeLines = summary.Rust.lines + summary.TypeScript.lines + summary.JavaScript.lines
const totalCodeBytes = summary.Rust.bytes + summary.TypeScript.bytes + summary.JavaScript.bytes

console.log(JSON.stringify({
  summary,
  percentages: {
    RustLines: ((summary.Rust.lines / totalCodeLines) * 100).toFixed(2) + "%",
    RustBytes: ((summary.Rust.bytes / totalCodeBytes) * 100).toFixed(2) + "%",
    TSLines: ((summary.TypeScript.lines / totalCodeLines) * 100).toFixed(2) + "%",
    TSBytes: ((summary.TypeScript.bytes / totalCodeBytes) * 100).toFixed(2) + "%",
    JSLines: ((summary.JavaScript.lines / totalCodeLines) * 100).toFixed(2) + "%",
    JSBytes: ((summary.JavaScript.bytes / totalCodeBytes) * 100).toFixed(2) + "%",
  },
  totalCodeLines,
  totalCodeBytesMB: (totalCodeBytes / (1024 * 1024)).toFixed(2) + " MB"
}, null, 2))
