import { $ } from "bun"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

if (process.versions.bun !== expectedBunVersion) {
  throw new Error(`This script requires bun@${expectedBunVersion}, but you are using bun@${process.versions.bun}`)
}

// Support both new navi_* and legacy OPENCODE_* env vars for backward compatibility
const env = {
  navi_CHANNEL: process.env["navi_CHANNEL"] || process.env["NAVI_CHANNEL"] || process.env["OPENCODE_CHANNEL"],
  navi_BUMP: process.env["navi_BUMP"] || process.env["NAVI_BUMP"] || process.env["OPENCODE_BUMP"],
  navi_VERSION: process.env["navi_VERSION"] || process.env["NAVI_VERSION"] || process.env["OPENCODE_VERSION"],
}
const CHANNEL = await (async () => {
  if (env.navi_CHANNEL) return env.navi_CHANNEL
  if (env.navi_BUMP) return "latest"
  if (env.navi_VERSION && !env.navi_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.navi_VERSION) return env.navi_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = await fetch("https://registry.npmjs.org/navi-ai-agent/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.navi_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
}
console.log(`navi script`, JSON.stringify(Script, null, 2))
