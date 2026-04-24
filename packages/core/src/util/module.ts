import { createRequire } from "node:module"
import path from "node:path"
import { Log } from "./log"

const log = Log.create({ service: "module-util" })

export namespace Module {
  export function resolve(id: string, dir: string) {
    try {
      return createRequire(path.join(dir, "package.json")).resolve(id)
    } catch (err) {
      log.debug("Failed to resolve module", { id, dir, error: err })
    }
  }
}

