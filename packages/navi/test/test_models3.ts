import { RoocodeProvider } from "../src/provider/providers/roocode"
import { ClineProvider } from "../src/provider/providers/cline"
import { Global } from "../src/global/index"

await Global.init()

async function main() {
    const rooda = await RoocodeProvider.load({} as any)
    console.log("Roo Code Models:", Object.keys(rooda.models ?? {}).length)
    console.log("Roo autoload:", rooda.autoload)
    console.log()

    const clida = await ClineProvider.load({} as any)
    console.log("Cline Models:", Object.keys(clida.models ?? {}).length)
    console.log("Cline autoload:", clida.autoload)
}

main().catch(console.error)
