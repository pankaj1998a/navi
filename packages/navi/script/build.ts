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
import { Script } from "@navi-ai/script"

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
    // {
    //   os: "linux",
    //   arch: "arm64",
    // },
    // {
    //   os: "linux",
    //   arch: "x64",
    // },
    // {
    //   os: "linux",
    //   arch: "x64",
    //   avx2: false,
    // },
    // {
    //   os: "linux",
    //   arch: "arm64",
    //   abi: "musl",
    // },
    // {
    //   os: "linux",
    //   arch: "x64",
    //   abi: "musl",
    // },
    // {
    //   os: "linux",
    //   arch: "x64",
    //   abi: "musl",
    //   avx2: false,
    // },
    // {
    //   os: "darwin",
    //   arch: "arm64",
    // },
    // {
    //   os: "darwin",
    //   arch: "x64",
    // },
    // {
    //   os: "darwin",
    //   arch: "x64",
    //   avx2: false,
    // },
    {
      os: "win32",
      arch: "x64",
    },
    {
      os: "win32",
      arch: "x64",
      avx2: false,
    },
    // {
    //   os: "win32",
    //   arch: "arm64",
    // },
  ]

const targets = singleFlag
  ? allTargets.filter((item) => {
    if (item.os !== process.platform || item.arch !== process.arch) {
      return false
    }

    // When building for the current platform, prefer a single native binary by default.
    // Baseline binaries require additional Bun artifacts and can be flaky to download.
    if (item.avx2 === false) {
      return baselineFlag
    }

    return true
  })
  : allTargets

// try {
//   await Bun.$`rm -rf dist`
// } catch (e) {
//   console.error("Failed to clean dist:", e)
// }

const binaries: Record<string, string> = {}

async function buildRust() {
  console.log("Building Rust components...")
  try {
    await $`cargo build --release`.cwd(path.resolve(dir, "../../navi-rs"))
    console.log("Rust components built successfully.")
  } catch (e) {
    console.error("Failed to build Rust components:", e)
    throw e
  }
}

async function build() {
  if (!skipInstall) {
    console.log("Installing native modules for all platforms...")
    await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
    await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
    console.log("Native modules installed.")
  }
  for (const item of targets) {
    const name = [
      pkg.name,
      // changing to win32 flags npm for some reason
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

    console.log(`building ${name} (target: ${bunTarget})`)
    await Bun.$`mkdir -p dist/${name}/bin`

    const parserWorker = fs.realpathSync(path.resolve(dir, "./node_modules/@opentui/core/parser.worker.js"))
    const workerPath = "./src/cli/cmd/tui/worker.ts"

    // Use platform-specific bunfs root path based on target OS
    const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
    const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

    // Path to worker file in the built executable
    // The worker file will be at bin/cli/cmd/tui/worker relative to the executable
    const builtWorkerPath = "./cli/cmd/tui/worker.js"

    try {
      // Build main navi binary
      await Bun.build({
        conditions: ["browser"],
        tsconfig: "./tsconfig.json",
        plugins: [solidPlugin],
        sourcemap: "external",
        minify: true,
        compile: {
          autoloadBunfig: false,
          autoloadDotenv: false,
          //@ts-ignore (bun types aren't up to date)
          autoloadTsconfig: true,
          target: bunTarget as any,
          outfile: `dist/${name}/bin/navi`,
          execArgv: [`--user-agent=navi/${Script.version}`, "--use-system-ca", "--"],
          windows: {},
        },
        entrypoints: ["./src/index.ts"],
        define: {
          NAVI_VERSION: `'${Script.version}'`,
          OTUI_TREE_SITTER_WORKER_PATH: `'${bunfsRoot + workerRelativePath}'`,
          NAVI_WORKER_PATH: `'${builtWorkerPath}'`,
          NAVI_CHANNEL: `'${Script.channel}'`,
          // Backward compatibility
          navi_VERSION: `'${Script.version}'`,
          navi_WORKER_PATH: `'${builtWorkerPath}'`,
          navi_CHANNEL: `'${Script.channel}'`,
          NAVI_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "''",
        },
      })

      // Build TUI worker separately to the expected location
      await Bun.$`mkdir -p dist/${name}/bin/cli/cmd/tui`
      await Bun.build({
        conditions: ["browser"],
        tsconfig: "./tsconfig.json",
        plugins: [solidPlugin],
        sourcemap: "external",
        minify: true,
        target: "bun",
        outdir: `dist/${name}/bin/cli/cmd/tui`,
        naming: "[name].js",
        entrypoints: [workerPath],
        define: {
          NAVI_VERSION: `'${Script.version}'`,
          OTUI_TREE_SITTER_WORKER_PATH: `'${bunfsRoot + workerRelativePath}'`,
          NAVI_WORKER_PATH: `'${builtWorkerPath}'`,
          NAVI_CHANNEL: `'${Script.channel}'`,
          // Backward compatibility
          navi_VERSION: `'${Script.version}'`,
          navi_WORKER_PATH: `'${builtWorkerPath}'`,
          navi_CHANNEL: `'${Script.channel}'`,
          NAVI_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "''",
        },
      })

      // Build parser worker separately
      await Bun.build({
        conditions: ["browser"],
        tsconfig: "./tsconfig.json",
        plugins: [solidPlugin],
        sourcemap: "external",
        minify: true,
        target: "bun",
        outdir: `dist/${name}/bin/cli/cmd/tui`,
        naming: "[name].js",
        entrypoints: [parserWorker],
        define: {
          NAVI_VERSION: `'${Script.version}'`,
          OTUI_TREE_SITTER_WORKER_PATH: `'${bunfsRoot + workerRelativePath}'`,
          NAVI_WORKER_PATH: `'${builtWorkerPath}'`,
          NAVI_CHANNEL: `'${Script.channel}'`,
          // Backward compatibility
          navi_VERSION: `'${Script.version}'`,
          navi_WORKER_PATH: `'${builtWorkerPath}'`,
          navi_CHANNEL: `'${Script.channel}'`,
          NAVI_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "''",
        },
      })

      // Rust binaries removed
      /*
      const rustBinaryName = item.os === "win32" ? "navi-mcp.exe" : "navi-mcp"
      const rustBinaryPath = path.resolve(dir, `../../navi-rs/target/release/${rustBinaryName}`)
      if (fs.existsSync(rustBinaryPath)) {
        await Bun.$`cp ${rustBinaryPath} dist/${name}/bin/${rustBinaryName}`
      }

      const rustCliName = item.os === "win32" ? "navi-cli.exe" : "navi-cli"
      const rustCliPath = path.resolve(dir, `../../navi-rs/target/release/${rustCliName}`)
      if (fs.existsSync(rustCliPath)) {
        await Bun.$`cp ${rustCliPath} dist/${name}/bin/${rustCliName}`
      }
      */

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
    } catch (e: any) {
      console.error(`Failed to build ${name}:`, e)
      if (e.logs) {
        console.error("Build logs:", e.logs)
      }
    }
  }
}

if (import.meta.main) {
  // await Bun.$`rm -rf dist`
  // await buildRust() // Rust removed
  await build()
}

export { binaries, build }
