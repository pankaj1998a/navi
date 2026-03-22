import { Global } from "./src/global/index.ts"
import { Auth } from "./src/auth/index.ts"

console.log("Global Path:", Global.Path.data)
async function test() {
    const all = await Auth.all()
    console.log("Keys in auth:", Object.keys(all))
}
test()
