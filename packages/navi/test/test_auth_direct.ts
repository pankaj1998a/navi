import { Env } from "./src/env/index.ts"
import { Auth } from "./src/auth/index.ts"
import { Config } from "./src/config/config.ts"
import { Global } from "./src/global/index.ts"

await Global.init()

async function main() {
    const auth = await Auth.get("roocode")
    console.log("Auth is defined:", !!auth)
    if (auth) {
        console.log("Auth type:", auth.type)
    }
}
main().catch(console.error)
