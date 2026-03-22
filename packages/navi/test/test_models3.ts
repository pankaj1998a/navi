import { RoocodeProvider } from "./src/provider/providers/roocode.ts"
import { ClineProvider } from "./src/provider/providers/cline.ts"
import { Global } from "./src/global/index.ts"

await Global.init()

async function main() {
    const rooda = await RoocodeProvider.load()
    console.log("Roo Code Models:", Object.keys(rooda.models).length)
    console.log("Roo autoload:", rooda.autoload)
    console.log()

    const clida = await ClineProvider.load()
    console.log("Cline Models:", Object.keys(clida.models).length)
    console.log("Cline autoload:", clida.autoload)
}

main().catch(console.error)
