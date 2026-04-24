import { Provider } from "../src/provider/provider"
import { Global } from "../src/global/index"
import { ProviderID } from "../src/provider/schema"

await Global.init()

async function main() {
    const providers = await Provider.list()
    const roo = providers[ProviderID.make("roocode")]
    console.log("Roocode models count:", roo ? Object.keys(roo.models ?? {}).length : "Not found")
    if (roo) {
        console.log("Roo source:", roo.source)
    }

    const cline = providers[ProviderID.make("cline")]
    console.log("Cline models count:", cline ? Object.keys(cline.models ?? {}).length : "Not found")
}

main().catch(console.error)
