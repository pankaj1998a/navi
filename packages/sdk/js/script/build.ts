#!/usr/bin/env bun

import { fileURLToPath } from "url"
const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

// await $`bun dev generate > ${dir}/openapi.json`.cwd(path.resolve(dir, "../../navi"))
// await $`cp ../openapi.json ${dir}/openapi.json`
import fs from "fs"
fs.copyFileSync(path.resolve(dir, "../openapi.json"), path.join(dir, "openapi.json"))

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "NaviClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

await $`bun x prettier --write src/v2`
await fs.promises.rm("dist", { recursive: true, force: true })
await $`bun x tsc`
await fs.promises.unlink("openapi.json")
