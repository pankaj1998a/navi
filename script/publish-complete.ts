#!/usr/bin/env bun

import { Script } from "./info"
import { $ } from "bun"

if (!Script.preview) {
  await $`gh release edit v${Script.version} --draft=false`
}

await $`bun install`

await $`gh release download --pattern "navi-linux-*64.tar.gz" --pattern "navi-darwin-*64.zip" -D dist`

await import(`../packages/navi/script/publish-registries.ts`)
