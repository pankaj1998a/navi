import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

// if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
//   throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
// }

const env = {
  NAVI_CHANNEL: process.env["NAVI_CHANNEL"],
  NAVI_BUMP: process.env["NAVI_BUMP"],
  NAVI_VERSION: process.env["NAVI_VERSION"],
  NAVI_RELEASE: process.env["NAVI_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.NAVI_CHANNEL) return env.NAVI_CHANNEL
  if (env.NAVI_BUMP) return "latest"
  if (env.NAVI_VERSION && !env.NAVI_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.NAVI_VERSION) return env.NAVI_VERSION
  if (IS_PREVIEW) return `${rootPkg.version}-${CHANNEL.replace("upgrade/", "").replace("opencode-", "")}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = await fetch("https://registry.npmjs.org/navi-ai/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.NAVI_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const bot = ["actions-user", "navi", "navi-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

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
  get release(): boolean {
    return !!env.NAVI_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`navi script`, JSON.stringify(Script, null, 2))
