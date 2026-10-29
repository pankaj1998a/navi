import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

/**
 * Verifies the committed generated client artifacts match what the codegen
 * produces from the current protocol contract.
 *
 * `generate.yml` auto-commits regenerated code to `dev`, so drift is never
 * surfaced to a reviewer. This gate fails CI instead, so a contract change
 * that was not regenerated cannot land.
 */

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const client = path.join(root, "packages", "client")
const targets = [path.join(client, "src", "generated"), path.join(client, "src", "generated-effect")]

const missing = targets.filter((t) => !existsSync(t))
if (missing.length > 0) {
  console.error("check:generated: missing generated directories:")
  for (const m of missing) console.error(`  - ${path.relative(root, m)}`)
  console.error("run `bun run --cwd packages/client build` to generate them")
  process.exit(1)
}

async function collect(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const glob = new Bun.Glob("**/*")
  for await (const rel of glob.scan({ cwd: dir, onlyFiles: true, dot: false })) {
    out.set(rel, await Bun.file(path.join(dir, rel)).text())
  }
  return out
}

const before = new Map<string, Map<string, string>>()
for (const t of targets) before.set(t, await collect(t))

try {
  execFileSync("bun", ["run", "generate"], { cwd: client, stdio: "inherit" })
} catch (err) {
  console.error("check:generated: codegen failed", err instanceof Error ? err.message : err)
  process.exit(1)
}

let drift = 0
for (const t of targets) {
  const after = await collect(t)
  const prev = before.get(t)!
  for (const [rel, content] of after) {
    if (!prev.has(rel)) {
      console.error(`check:generated: new file ${path.relative(root, path.join(t, rel))}`)
      drift++
      continue
    }
    if (prev.get(rel) !== content) {
      console.error(`check:generated: changed file ${path.relative(root, path.join(t, rel))}`)
      drift++
    }
  }
  for (const rel of prev.keys()) {
    if (!after.has(rel)) {
      console.error(`check:generated: removed file ${path.relative(root, path.join(t, rel))}`)
      drift++
    }
  }
}

if (drift > 0) {
  console.error(`\ncheck:generated: ${drift} generated file(s) are out of date.`)
  console.error("run `bun run --cwd packages/client build` and commit the result.")
  process.exit(1)
}

console.log("check:generated: generated client is up to date")
