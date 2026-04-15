import { ModelsDev } from "../src/provider/models"

async function main() {
    const modelsDev = await ModelsDev.get()
    console.log("Keys in modelsDev:", Object.keys(modelsDev).filter(x => x.includes("roo")))
    console.log("RooCode in modelsDev:", !!modelsDev["roocode"])
}

main().catch(console.error)
