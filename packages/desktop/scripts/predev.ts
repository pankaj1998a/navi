import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.NAVI_CHANNEL ?? "dev"}`

await $`cd ../navi && bun script/build-node.ts`
