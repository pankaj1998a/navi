import { Provider } from "./src/provider/provider.ts"
import { Global } from "./src/global/index.ts"

await Global.init()

async function main() {
    const providers = await Provider.list()
    const roo = providers["roocode"]
    console.log("Roocode models count:", roo ? Object.keys(roo.models).length : "Not found")
    if (roo) {
        console.log("Roo source:", roo.source)
    }

    const cline = providers["cline"]
    console.log("Cline models count:", cline ? Object.keys(cline.models).length : "Not found")
}

main().catch(console.error)
