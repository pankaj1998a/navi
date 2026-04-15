import { Provider } from "../src/provider/provider"
import { Global } from "../src/global/index"
import { Instance } from "../src/project/instance"

await Global.init()

async function main() {
    const providers = Object.values(await Provider.list())
    const roo = providers.find((p: any) => p.id === "roocode")
    console.log("Roocode models count:", roo ? Object.keys(roo.models ?? {}).length : "Not found")
    if (roo) {
        console.log("Roo source:", (roo as any).source)
    }

    const cline = providers.find((p: any) => p.id === "cline")
    console.log("Cline models count:", cline ? Object.keys(cline.models ?? {}).length : "Not found")
}

main().catch(console.error)
