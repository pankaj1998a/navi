
import { Storage } from "./src/storage/storage"
import { Log } from "./src/util/log"
import { Global } from "./src/global/index"
import path from "path"

console.log("Global Data Path:", Global.Path.data)
console.log("Storage Path:", path.join(Global.Path.data, "storage"))

async function main() {
    try {
        console.log("Listing projects...")
        const projects = await Storage.list(["project"])
        console.log("Projects:", projects)
    } catch (e) {
        console.error("Storage list error:", e)
    }
}

main()
