import path from "path"
import { Effect } from "effect"
import { NpmConfig } from "../src/npm-config"
import { tmpdir } from "./fixture/tmpdir"
// @ts-expect-error
import Config from "@npmcli/config"
// @ts-expect-error
import { definitions, flatten, nerfDarts, shorthands } from "@npmcli/config/lib/definitions/index.js"
import { fileURLToPath } from "url"

async function run() {
  const tmp = await tmpdir()
  const filePath = path.join(tmp.path, ".npmrc")
  console.log("Temp dir path:", tmp.path)
  console.log("File path:", filePath)
  await Bun.write(filePath, "registry=https://registry.example.test/\n")
  await Bun.write(path.join(tmp.path, "package.json"), "{}")
  
  // Try loading it
  const config = await Effect.runPromise(NpmConfig.load(tmp.path))
  console.log("Flat config keys:", Object.keys(config).filter(k => k.includes("registry") || k.includes("acme")))
  console.log("Loaded registry:", config.registry)
  
  const npmPath = fileURLToPath(new URL("../src", import.meta.url))
  const c = new Config({
    npmPath,
    cwd: tmp.path,
    env: { ...process.env },
    argv: [process.execPath, process.execPath],
    execPath: process.execPath,
    platform: process.platform,
    definitions,
    flatten,
    nerfDarts,
    shorthands,
    warn: false,
  })
  await c.load()
  console.log("Direct flat config registry:", c.flat.registry)
  console.log("Direct flat config projects:", c.sources.get("project"))
  
  await tmp[Symbol.asyncDispose]()
}

run().catch(console.error)
