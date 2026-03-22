import { Log } from "@/util/log"
import { Bonjour } from "bonjour-service"

const log = Log.create({ service: "mdns" })

export namespace MDNS {
  let bonjour: Bonjour | undefined
  let currentPort: number | undefined

  export function publish(port: number, name = "navi") {
    if (currentPort === port) return
    if (bonjour) unpublish()

    try {
      bonjour = new Bonjour()

      // Suppress "Service name is already in use" from bonjour internals
      const origConsoleLog = console.log
      console.log = (...args: any[]) => {
        const msg = args.join(" ")
        if (msg.includes("Service name is already in use")) {
          log.warn("mDNS name conflict (suppressed)")
          return
        }
        origConsoleLog(...args)
      }

      const service = bonjour.publish({
        name,
        type: "http",
        port,
        txt: { path: "/" },
      })

      setTimeout(() => { console.log = origConsoleLog }, 3000)

      service.on("up", () => {
        log.info("mDNS service published", { name, port })
      })

      service.on("error", (err) => {
        log.warn("mDNS service error (non-fatal)", { error: String(err) })
      })

      currentPort = port
    } catch (err) {
      log.warn("mDNS publish failed (non-fatal)", { error: String(err) })
      if (bonjour) {
        try {
          bonjour.destroy()
        } catch { }
      }
      bonjour = undefined
      currentPort = undefined
    }
  }

  export function unpublish() {
    if (bonjour) {
      try {
        bonjour.unpublishAll()
        bonjour.destroy()
      } catch (err) {
        log.error("mDNS unpublish failed", { error: err })
      }
      bonjour = undefined
      currentPort = undefined
      log.info("mDNS service unpublished")
    }
  }
}
