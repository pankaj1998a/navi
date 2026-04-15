import { Env } from "../src/env/index"
import { Auth } from "../src/auth/index"
import { Config } from "../src/config/config"
import { Global } from "../src/global/index"

await Global.init()

async function main() {
    const auth = await Auth.get("roocode")
    console.log("Auth is defined:", !!auth)
    if (auth) {
        console.log("Auth type:", auth.type)
    }
}
main().catch(console.error)
