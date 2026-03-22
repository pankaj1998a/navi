import { Provider } from "./src/provider/provider.ts"
import { Global } from "./src/global/index.ts"
import { Instance } from "./src/project/instance.ts"

await Global.init()
await Instance.init({
    configPath: "",
    cwd: process.cwd(),
})

async function main() {
    await Instance.with(undefined as any, async () => {
        const providers = await Provider.all()
        const roo = providers.find(p => p.id === "roocode")
        console.log("Roocode models count:", roo ? Object.keys(roo.models).length : "Not found")
        if (roo) {
            console.log("Roo source:", roo.source)
        }

        const cline = providers.find(p => p.id === "cline")
        console.log("Cline models count:", cline ? Object.keys(cline.models).length : "Not found")
    })
}

main().catch(console.error)
