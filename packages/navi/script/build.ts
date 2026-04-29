#!/usr/bin/env bun

import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import path from "path"
import fs from "fs"
import { $ } from "bun"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import pkg from "../package.json"
import { Script } from "../../../script/info"

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const bunExe = process.execPath
type Migration = {
  sql: string
  timestamp: number
  name: string
}

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
    {
      os: "win32",
      arch: "x64",
    },
    {
      os: "win32",
      arch: "x64",
      avx2: false,
    },
  ]

const binaries: Record<string, string> = {}

async function build(options: { singleFlag?: boolean; baselineFlag?: boolean; skipInstall?: boolean } = {}) {
  const useSingleFlag = options.singleFlag ?? singleFlag
  const useBaselineFlag = options.baselineFlag ?? baselineFlag
  const useSkipInstall = options.skipInstall ?? skipInstall

  const targets = useSingleFlag
    ? allTargets.filter((item) => {
        if (item.os !== process.platform || item.arch !== process.arch) {
          return false
        }
        if (item.avx2 === false) {
          return useBaselineFlag
        }
        return true
      })
    : allTargets

  if (!useSkipInstall && !useSingleFlag) {
    console.log("Installing native modules for all platforms...")
    try {
      await $`${bunExe} install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
      await $`${bunExe} install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
      console.log("Native modules installed.")
    } catch (e) {
      console.warn("Failed to install native modules for all platforms, proceeding with local versions.", e)
    }
  }

  const migrationDir = path.resolve(dir, "./migration")
  const migrations = fs
    .readdirSync(migrationDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .map<Migration | undefined>((name) => {
      const file = path.join(migrationDir, name, "migration.sql")
      if (!fs.existsSync(file)) return
      const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
      const timestamp = match
        ? Date.UTC(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3]),
            Number(match[4]),
            Number(match[5]),
            Number(match[6]),
          )
        : 0
      return {
        sql: fs.readFileSync(file, "utf-8"),
        timestamp,
        name,
      }
    })
    .filter((migration): migration is Migration => Boolean(migration))
    .sort((a, b) => a.timestamp - b.timestamp)

  for (const item of targets) {
    const name = [
      pkg.name,
      item.os === "win32" ? "windows" : item.os,
      item.arch,
      item.avx2 === false ? "baseline" : undefined,
      item.abi === undefined ? undefined : item.abi,
    ]
      .filter(Boolean)
      .join("-")

    const bunTarget = [
      "bun",
      item.os === "win32" ? "windows" : item.os,
      item.arch === "arm64" ? (item.os === "win32" ? "aarch64" : "arm64") : item.arch,
      item.avx2 === false ? "baseline" : undefined,
    ]
      .filter(Boolean)
      .join("-")
    type CompileTarget = "bun-windows-x64" | "bun-windows-x64-baseline"
    const compileTarget = bunTarget as CompileTarget

    console.log(`building ${name} (target: ${bunTarget})`)
    await Bun.$`mkdir -p dist/${name}/bin`

    const parserWorker = fs.realpathSync(path.resolve(dir, "./node_modules/@opentui/core/parser.worker.js"))
    const workerPath = "./src/cli/cmd/tui/worker.ts"

    const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
    const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")
    const builtWorkerPath = "./cli/cmd/tui/worker.js"

    const define = {
      NAVI_VERSION: `'${Script.version}'`,
      OTUI_TREE_SITTER_WORKER_PATH: `'${bunfsRoot + workerRelativePath}'`,
      NAVI_WORKER_PATH: `'${workerPath}'`,
      NAVI_CHANNEL: `'${Script.channel}'`,
      navi_VERSION: `'${Script.version}'`,
      navi_WORKER_PATH: `'${workerPath}'`,
      navi_CHANNEL: `'${Script.channel}'`,
      NAVI_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "''",
      FEATURE_VOICE: "true",
      FEATURE_TELEPORT: "true",
      FEATURE_BRIDGE: "true",
      FEATURE_SENTRY: "true",
      FEATURE_SPECULATION: "true",
      FEATURE_SYMBOL_GRAPH: "true",
      NAVI_MIGRATIONS: JSON.stringify(migrations),
    }

    try {
      // Build main navi binary
      await Bun.build({
        tsconfig: "./tsconfig.json",
        plugins: [solidPlugin],
        sourcemap: "none",
        minify: false,
        compile: {
          autoloadBunfig: false,
          autoloadDotenv: false,
          target: compileTarget,
          outfile: `dist/${name}/bin/navi`,
          execArgv: [`--user-agent=navi/${Script.version}`, "--use-system-ca", "--"],
          windows: {},
        },
        entrypoints: ["./src/index.ts", parserWorker, workerPath],
        define,
      })

      // Build TUI worker
      await Bun.$`mkdir -p dist/${name}/bin/cli/cmd/tui`
      await Bun.build({
        tsconfig: "./tsconfig.json",
        plugins: [solidPlugin],
        sourcemap: "none",
        minify: false,
        target: "bun",
        outdir: `dist/${name}/bin/cli/cmd/tui`,
        naming: "[name].js",
        entrypoints: [workerPath],
        define,
      })

      // Build parser worker
      await Bun.build({
        conditions: ["browser"],
        tsconfig: "./tsconfig.json",
        plugins: [solidPlugin],
        sourcemap: "none",
        minify: false,
        target: "bun",
        outdir: `dist/${name}/bin/cli/cmd/tui`,
        naming: "[name].js",
        entrypoints: [parserWorker],
        define,
      })

      await Bun.file(`dist/${name}/package.json`).write(
        JSON.stringify(
          {
            name,
            version: Script.version,
            os: [item.os],
            cpu: [item.arch],
            bin: {
              navi: item.os === "win32" ? "bin/navi.exe" : "bin/navi",
            },
          },
          null,
          2,
        ),
      )
      binaries[name] = Script.version
    } catch (e: unknown) {
      console.error(`Failed to build ${name}:`, e)
      if (typeof e === "object" && e && "logs" in e) {
        console.error("Build logs:", (e as { logs?: unknown }).logs)
      }
      process.exit(1)
    }
  }
}

if (import.meta.main) {
  await build()
}

export { binaries, build }
